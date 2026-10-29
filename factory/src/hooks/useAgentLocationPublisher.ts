import { useEffect, useRef, useState } from 'react';
import { Socket, io } from 'socket.io-client';
import { ensureAccessToken, getAccessToken, refreshSessionAccessToken } from '../services/apiClient';
import { GPS_TIMEOUT_MS, MAXIMUM_GPS_ACCURACY_METERS } from '../services/deviceGps';
import { createSingleGpsWatcher, type SingleGpsWatcher } from '../services/gpsWatcher';
import {
  enqueueGpsPoint,
  listQueuedGpsPoints,
  QueuedGpsPoint,
  removeQueuedGpsPoints,
} from '../services/gpsQueue';
import { trackingLog } from '../services/trackingLog';

export type LocationPublisherState =
  | 'tracking-stopped'
  | 'requesting-permission'
  | 'gps-unavailable'
  | 'permission-denied'
  | 'gps-timeout'
  | 'poor-accuracy'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'tracking-active'
  | 'error';

const MINIMUM_UPLOAD_INTERVAL_MS = 30_000;
const MINIMUM_MOVEMENT_METERS = 10;
const MAXIMUM_UPLOAD_ACCURACY_METERS = 500;
let activeImmediateUploader: ((point: QueuedGpsPoint) => Promise<void>) | undefined;

const distanceMeters = (a: GeolocationCoordinates, b: GeolocationCoordinates) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export const uploadGpsPointImmediately = async (point: QueuedGpsPoint) => {
  if (!activeImmediateUploader) throw new Error('GPS tracking connection is not active.');
  await activeImmediateUploader(point);
};

export const useAgentLocationPublisher = (enabled: boolean, agentId?: string) => {
  const [state, setState] = useState<LocationPublisherState>('tracking-stopped');
  const [accuracyMeters, setAccuracyMeters] = useState<number>();
  const socketRef = useRef<Socket>();
  const configuredSocketUrl = import.meta.env.VITE_TRACKING_SOCKET_URL?.trim();
  const socketUrl = configuredSocketUrl === 'same-origin' ? undefined : configuredSocketUrl;

  useEffect(() => {
    let disposed = false;
    let watcher: SingleGpsWatcher | undefined;
    let hasConnected = false;
    let lastAcceptedPosition: GeolocationPosition | undefined;
    let lastUploadedAt = 0;
    let latestFixHasPoorAccuracy = false;
    let refreshingSocketToken = false;
    let uploadChain = Promise.resolve();

    const reportPermission = (permission: 'granted' | 'denied' | 'prompt' | 'unavailable') => {
      socketRef.current?.emit('tracking:location-permission', { permission });
    };

    const emitBatch = (socket: Socket, points: QueuedGpsPoint[]) => new Promise<void>((resolve, reject) => {
      socket.timeout(30_000).emit('tracking:batch', points, (
        timeoutError: Error | null,
        response?: { ok?: boolean; results?: Array<{ ok: boolean; error?: string; clientPointId?: string }> },
      ) => {
        if (timeoutError || !response?.ok) return reject(timeoutError ?? new Error('GPS batch was not accepted.'));
        const completedIds = response.results
          ?.filter((result) => result.ok || ['SHIFT_NOT_ACTIVE', 'INVALID_CAPTURE_TIME', 'VALIDATION_ERROR', 'AGENT_ID_MISMATCH'].includes(result.error ?? ''))
          .map((result) => result.clientPointId).filter(Boolean) as string[];
        void removeQueuedGpsPoints(completedIds).then(() => resolve(), reject);
      });
    });

    const flushQueue = async () => {
      const socket = socketRef.current;
      if (!agentId || !socket?.connected) throw new Error('GPS socket is disconnected.');
      const queued = await listQueuedGpsPoints(agentId);
      for (let offset = 0; offset < queued.length; offset += 100) {
        await emitBatch(socket, queued.slice(offset, offset + 100));
      }
    };

    const uploadPoint = async (point: QueuedGpsPoint) => {
      await enqueueGpsPoint(point);
      const socket = socketRef.current;
      if (!socket?.connected) {
        setState(navigator.onLine ? 'reconnecting' : 'offline');
        return;
      }
      await flushQueue();
      if (!disposed) setState(latestFixHasPoorAccuracy ? 'poor-accuracy' : 'tracking-active');
    };

    const handlePosition = (position: GeolocationPosition) => {
      if (!agentId || disposed) return;
      const { coords } = position;
      setAccuracyMeters(Math.round(coords.accuracy));
      reportPermission('granted');
      latestFixHasPoorAccuracy = coords.accuracy > MAXIMUM_GPS_ACCURACY_METERS;
      if (latestFixHasPoorAccuracy) {
        setState('poor-accuracy');
      }
      // Coarse but usable fixes are still published. Only reject impossible/noisy fixes.
      if (coords.accuracy > MAXIMUM_UPLOAD_ACCURACY_METERS) {
        return;
      }
      const now = Date.now();
      const moved = lastAcceptedPosition ? distanceMeters(lastAcceptedPosition.coords, coords) : Number.POSITIVE_INFINITY;
      if (now - lastUploadedAt < MINIMUM_UPLOAD_INTERVAL_MS && moved < MINIMUM_MOVEMENT_METERS) return;
      lastAcceptedPosition = position;
      lastUploadedAt = now;
      const capturedAt = new Date(position.timestamp).toISOString();
      const point: QueuedGpsPoint = {
        clientPointId: crypto.randomUUID(), agentId,
        latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
        speedKmH: coords.speed == null ? undefined : Math.max(0, Math.min(300, coords.speed * 3.6)),
        heading: coords.heading == null || !Number.isFinite(coords.heading) ? undefined : Math.max(0, Math.min(360, coords.heading)),
        altitude: coords.altitude == null ? undefined : Math.max(-500, Math.min(10_000, coords.altitude)),
        capturedAt, deviceTimestamp: capturedAt,
      };
      uploadChain = uploadChain.then(() => uploadPoint(point)).then(() => {
        trackingLog('gps-success', { agentId, accuracyMeters: Math.round(coords.accuracy), deviceTimestamp: capturedAt });
      }).catch((error) => {
          if (!disposed) setState(socketRef.current?.connected ? 'error' : 'offline');
          trackingLog('gps-error', { agentId, message: error instanceof Error ? error.message : String(error) }, 'error');
      });
    };

    const handlePositionError = (error: GeolocationPositionError) => {
      if (disposed) return;
      if (error.code === error.PERMISSION_DENIED) {
        setState('permission-denied');
        reportPermission('denied');
      } else if (error.code === error.TIMEOUT) setState('gps-timeout');
      else setState('gps-unavailable');
      trackingLog('gps-error', { agentId, code: error.code, message: error.message }, 'error');
    };

    const startPositionWatcher = () => {
      watcher ??= createSingleGpsWatcher(navigator.geolocation, handlePosition, handlePositionError, {
        enableHighAccuracy: true,
        maximumAge: 2_000,
        timeout: GPS_TIMEOUT_MS,
      });
      watcher.start();
    };

    const restartPositionWatcher = () => {
      watcher?.restart();
    };

    const recoverConnection = () => {
      if (disposed) return;
      const socket = socketRef.current;
      if (socket && !socket.connected) socket.connect();
      void flushQueue().catch(() => undefined);
    };

    const handleOnline = () => recoverConnection();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      restartPositionWatcher();
      recoverConnection();
    };

    const stop = () => {
      watcher?.stop();
      watcher = undefined;
      socketRef.current?.disconnect();
      socketRef.current = undefined;
      if (activeImmediateUploader === uploadPoint) activeImmediateUploader = undefined;
      setState('tracking-stopped');
    };

    if (!enabled || !agentId) {
      stop();
      return;
    }
    if (!configuredSocketUrl || !('geolocation' in navigator)) {
      setState('gps-unavailable');
      return stop;
    }
    const isLocalLoopback =
      window.location.hostname === 'localhost' ||
      /^127(?:\.\d{1,3}){3}$/.test(window.location.hostname) ||
      window.location.hostname === '[::1]';
    if (!window.isSecureContext && !isLocalLoopback) {
      trackingLog('gps-error', { agentId, message: 'Live GPS requires HTTPS on mobile devices.' }, 'error');
      setState('gps-unavailable');
      return stop;
    }

    setState('requesting-permission');
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void ensureAccessToken().then(() => {
      if (disposed) return;
      const socket = io(socketUrl, { transports: ['websocket'], withCredentials: true,
        auth: (callback) => callback({ token: getAccessToken() ?? undefined }),
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
      });
      socketRef.current = socket;
      activeImmediateUploader = uploadPoint;
      socket.on('connect', () => {
        if (disposed) return;
        setState('connected');
        if (hasConnected) trackingLog('socket-reconnect', { agentId, socketId: socket.id });
        hasConnected = true;
        void flushQueue().catch(() => setState('reconnecting'));
        startPositionWatcher();
      });
      socket.on('disconnect', (reason) => {
        if (!disposed) setState(navigator.onLine ? 'reconnecting' : 'offline');
        trackingLog('socket-disconnect', { agentId, reason }, 'warn');
      });
      socket.on('connect_error', (error) => {
        if (!disposed) setState(navigator.onLine ? 'reconnecting' : 'offline');
        if (refreshingSocketToken || !/auth|token|unauth/i.test(error.message)) return;
        refreshingSocketToken = true;
        void refreshSessionAccessToken().then((token) => {
          if (disposed) return;
          socket.auth = { token };
          socket.connect();
        }).catch(() => setState('offline')).finally(() => {
          refreshingSocketToken = false;
        });
      });
      startPositionWatcher();
    }).catch(() => setState('offline'));

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stop();
    };
  }, [agentId, configuredSocketUrl, enabled, socketUrl]);

  return { state, accuracyMeters, poorAccuracyThresholdMeters: MAXIMUM_GPS_ACCURACY_METERS };
};
