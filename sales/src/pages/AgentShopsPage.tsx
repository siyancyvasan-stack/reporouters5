import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useToast } from "../context/ToastContext";
import { Store, Phone, MapPin, CheckCircle2, Navigation, X, LocateFixed, Camera } from "lucide-react";
import { loadShops } from "../services/domainApi";
import { capturePreciseGpsPoint } from "../services/deviceGps";
import { ApiError, apiRequest } from "../services/apiClient";
import { useAuth } from "../context/AuthContext";
import { ExportButton } from "../components/common/ExportButton";
import {
  exportToCsv,
  exportToPdf,
  type ExportColumn,
} from "../services/exportService";
import type { Shop } from "../types";

export const AgentShopsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [shops, setShops] = useState<Awaited<ReturnType<typeof loadShops>>>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [shopsError, setShopsError] = useState<string | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  
  const loadShopList = async () => {
    setShopsLoading(true);
    setShopsError(null);
    try {
      const loadedShops = await loadShops([]);
      setShops(loadedShops);
    } catch (error) {
      setShops([]);
      setShopsError(
        error instanceof Error
          ? error.message
          : "Unable to load your assigned shops.",
      );
    } finally {
      setShopsLoading(false);
    }
  };
  
  useEffect(() => {
    void loadShopList();
  }, []);

  const exportDate = new Date().toLocaleDateString("en-CA");
  const shopColumns: ExportColumn<Shop>[] = [
    { header: "Shop Name", value: (shop) => shop.name },
    { header: "Address", value: (shop) => shop.address },
    { header: "Territory", value: (shop) => shop.territory ?? shop.routeGroup },
    {
      header: "Visit Status",
      value: (shop) => (shop.visitedToday ? "Visited" : "Not Visited"),
    },
    {
      header: "Outstanding Balance",
      value: (shop) => shop.outstandingBalanceLkr,
    },
    {
      header: "Assigned Agent",
      value: (shop) => shop.assignedAgentName ?? user?.name,
    },
    { header: "Contact Number", value: (shop) => shop.phone },
    {
      header: "Last Visit Date",
      value: (shop) =>
        shop.lastVisitAt ? new Date(shop.lastVisitAt).toLocaleDateString() : "",
    },
  ];
  const exportShops = async (format: "csv" | "pdf") => {
    const filename = `assigned_shops_${exportDate}.${format}`;
    if (format === "csv")
      return exportToCsv(shops, { columns: shopColumns }, filename);
    const visited = shops.filter((shop) => shop.visitedToday).length;
    await exportToPdf(
      shops,
      {
        title: "Assigned Territory Stores Report",
        subtitle: "Currently displayed assigned retailer network",
        metadata: [
          ["Assigned Agent", user?.name],
          [
            "Territory",
            [
              ...new Set(
                shops
                  .map((shop) => shop.territory ?? shop.routeGroup)
                  .filter(Boolean),
              ),
            ].join(", ") || "Not assigned",
          ],
        ],
        kpis: [
          ["Total Shops", shops.length],
          ["Visited", visited],
          ["Not Visited", shops.length - visited],
          [
            "Outstanding Balance",
            `LKR ${shops.reduce((sum, shop) => sum + shop.outstandingBalanceLkr, 0).toLocaleString()}`,
          ],
        ],
        columns: shopColumns,
      },
      filename,
    );
  };

  const handleCheckIn = async (shopId: string, shopName: string) => {
    if (!user?.id) return;
    try {
      const point = await capturePreciseGpsPoint(user.id);
      await apiRequest(`/api/v1/shops/${shopId}/visits`, {
        method: "POST",
        body: JSON.stringify({
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
        }),
      });
      setShops((prev) =>
        prev.map((s) => (s.id === shopId ? { ...s, visitedToday: true } : s)),
      );
      showToast("GPS Verified", `Checked in at ${shopName}.`, "success");
    } catch (error) {
      showToast(
        "Check-in failed",
        error instanceof Error ? error.message : "GPS unavailable.",
        "error",
      );
    }
  };

  return (
    <AgentLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-white">
              Assigned Territory Stores
            </h2>
            <p className="text-xs text-slate-400">
              Your approved and assigned retailer network
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ExportButton
              dataset="shop_visits"
              pdf
              formats={["pdf", "csv"]}
              onExport={(format) => exportShops(format as "csv" | "pdf")}
            />
            <button
              onClick={() => setShowRegisterForm(true)}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-colors"
            >
              + Register Shop
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {shopsLoading && Array.from({ length: 3 }).map((_, index) => (
            <GlassCard key={index} className="h-44 animate-pulse p-5" />
          ))}

          {!shopsLoading && shopsError && (
            <GlassCard className="space-y-3 p-5 text-center">
              <p className="font-bold text-rose-600">Unable to load assigned shops</p>
              <p className="text-sm text-slate-500">{shopsError}</p>
              <button
                type="button"
                onClick={() => void loadShopList()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500"
              >
                Try again
              </button>
            </GlassCard>
          )}

          {!shopsLoading && !shopsError && shops.length === 0 && (
            <GlassCard className="space-y-3 p-8 text-center">
              <Store className="mx-auto h-9 w-9 text-indigo-500" />
              <div>
                <p className="font-bold text-slate-900">No shops assigned yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Your manager can assign stores here, or you can register a new shop.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterForm(true)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500"
              >
                Register new shop
              </button>
            </GlassCard>
          )}

          {!shopsLoading && !shopsError && shops.map((shop) => (
            <GlassCard key={shop.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-cyan-500/20 text-cyan-400">
                    {shop.primaryImageUrl ? (
                      <img
                        src={shop.primaryImageUrl}
                        alt={shop.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Store className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      {shop.name}
                    </h3>
                    <p className="text-xs text-slate-400">{shop.ownerName}</p>
                  </div>
                </div>

                {shop.visitedToday && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Visited
                  </span>
                )}
              </div>

              <div className="space-y-1 text-xs text-slate-300 border-t border-slate-800 pt-3">
                <p className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{shop.address}</span>
                </p>
                <p className="flex items-center gap-2 text-slate-400">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{shop.phone}</span>
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-semibold">
                  Outstanding Balance:
                </span>
                <span className="font-extrabold text-amber-400">
                  LKR {shop.outstandingBalanceLkr.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                {!shop.visitedToday && (
                  <button
                    onClick={() => void handleCheckIn(shop.id, shop.name)}
                    className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
                  >
                    GPS Check-In
                  </button>
                )}
                <button
                  onClick={() => navigate(`/sales/new-order?shopId=${encodeURIComponent(shop.id)}`)}
                  className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                >
                  Book Order
                </button>
                <a
                  href={`tel:${shop.phone}`}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300"
                >
                  Call
                </a>
                {Number.isFinite(shop.coordinates.lat) && (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${shop.coordinates.lat},${shop.coordinates.lng}`}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300"
                  >
                    <Navigation className="h-4" />
                  </a>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
        
        <ShopRegistrationDrawer
          open={showRegisterForm}
          userId={user?.id}
          close={() => setShowRegisterForm(false)}
          saved={async () => {
            setShowRegisterForm(false);
            await loadShopList();
            showToast("Shop Registered", "The shop has been successfully registered.", "success");
          }}
        />
      </div>
    </AgentLayout>
  );
};

type ShopForm = {
  name: string;
  ownerName: string;
  phone: string;
  alternateMobile: string;
  nicNumber: string;
  brNumber: string;
  email: string;
  address: string;
  city: string;
  latitude: string;
  longitude: string;
  creditLimitLkr: string;
  paymentTerms: string;
  active: "true" | "false";
  notes: string;
};

const blankForm: ShopForm = {
  name: "",
  ownerName: "",
  phone: "",
  alternateMobile: "",
  nicNumber: "",
  brNumber: "",
  email: "",
  address: "",
  city: "",
  latitude: "",
  longitude: "",
  creditLimitLkr: "",
  paymentTerms: "",
  active: "true",
  notes: "",
};

const phoneRegex = /^\+?[0-9][0-9\s()-]{6,19}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optional = (v: string) => v.trim() || undefined;

const ShopRegistrationDrawer = ({
  open,
  userId,
  close,
  saved,
}: {
  open: boolean;
  userId?: string;
  close: () => void;
  saved: () => Promise<void>;
}) => {
  const { showToast } = useToast();
  const [form, setForm] = useState<ShopForm>(blankForm);
  const [errors, setErrors] = useState<Partial<Record<keyof ShopForm | "form", string>>>({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [shopPhoto, setShopPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(blankForm);
      setErrors({});
      setShopPhoto(null);
      setPhotoPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && !saving && close();
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [open, saving, close]);

  if (!open) return null;

  const set =
    (k: keyof ShopForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors((x) => ({ ...x, [k]: undefined, form: undefined }));
    };

  const validate = () => {
    const x: typeof errors = {};
    (["name", "ownerName", "phone", "address", "city"] as const).forEach((k) => {
      if (!form[k].trim()) x[k] = "This field is required.";
    });
    if (form.phone && !phoneRegex.test(form.phone))
      x.phone = "Enter a valid mobile number.";
    if (form.alternateMobile && !phoneRegex.test(form.alternateMobile))
      x.alternateMobile = "Enter a valid alternate mobile number.";
    if (form.email && !emailRegex.test(form.email))
      x.email = "Enter a valid email address.";
    if (!form.latitude || !form.longitude)
      x.latitude = "Capture or enter both latitude and longitude.";
    else if (Number(form.latitude) < -90 || Number(form.latitude) > 90)
      x.latitude = "Latitude must be between -90 and 90.";
    if (form.longitude && (Number(form.longitude) < -180 || Number(form.longitude) > 180))
      x.longitude = "Longitude must be between -180 and 180.";
    if (form.creditLimitLkr && Number(form.creditLimitLkr) < 0)
      x.creditLimitLkr = "Credit limit cannot be negative.";
    setErrors(x);
    return !Object.keys(x).length;
  };

  const locate = async () => {
    if (!userId) return;
    setLocating(true);
    try {
      const p = await capturePreciseGpsPoint(userId);
      setForm((f) => ({
        ...f,
        latitude: String(p.latitude),
        longitude: String(p.longitude),
      }));
      showToast("GPS Location Captured", `Lat: ${p.latitude.toFixed(6)}, Lng: ${p.longitude.toFixed(6)}`, "success");
    } catch (e) {
      setErrors((x) => ({
        ...x,
        form: e instanceof Error ? e.message : "Could not capture GPS location.",
      }));
    } finally {
      setLocating(false);
    }
  };

  const selectShopPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((current) => ({ ...current, form: "Choose a JPG, PNG, or WebP shop photo." }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((current) => ({ ...current, form: "Shop photo must be 5 MB or smaller." }));
      return;
    }
    setShopPhoto(file);
    setErrors((current) => ({ ...current, form: undefined }));
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (!shopPhoto) {
      setErrors({ form: "Capture or upload a shop-front photo before registering." });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const createdShop = await apiRequest<{ id: string }>("/api/v1/shops", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          ownerName: form.ownerName.trim(),
          phone: form.phone.trim(),
          alternateMobile: optional(form.alternateMobile),
          nicNumber: optional(form.nicNumber),
          brNumber: optional(form.brNumber),
          email: optional(form.email),
          address: form.address.trim(),
          city: form.city.trim(),
          latitude: form.latitude ? Number(form.latitude) : undefined,
          longitude: form.longitude ? Number(form.longitude) : undefined,
          creditLimitLkr: Number(form.creditLimitLkr || 0),
          paymentTerms: optional(form.paymentTerms),
          active: form.active === "true",
          notes: optional(form.notes),
          outstandingBalanceLkr: 0,
          preferredProducts: [],
          requiredProducts: [],
          productCategories: [],
          preferredVisitDays: [],
          paymentMethod: "CASH",
        }),
      });
      const image = new FormData();
      image.append("image", shopPhoto);
      image.append("type", "STOREFRONT");
      image.append("isPrimary", "true");
      await apiRequest(`/api/v1/shops/${createdShop.id}/images`, {
        method: "POST",
        body: image,
      });
      await saved();
    } catch (e) {
      setErrors({
        form:
          e instanceof ApiError && e.code === "DUPLICATE_RETAILER"
            ? "A retailer with this shop name, mobile, NIC or business registration number already exists."
            : e instanceof Error
              ? e.message
              : "Could not save the retailer.",
      });
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && close()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-title"
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-y-auto rounded-[1.5rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,.92),rgba(245,243,255,.78)_52%,rgba(239,246,255,.82))] shadow-[0_30px_90px_rgba(30,41,59,.3),0_8px_28px_rgba(79,70,229,.16)] backdrop-blur-[20px] motion-safe:animate-[premium-page-enter_240ms_cubic-bezier(0.16,1,.3,1)_both]"
      >
        <header className="sticky top-0 z-10 flex shrink-0 justify-between border-b border-white/70 bg-white/72 px-5 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-indigo-600">
              Register New Shop
            </p>
            <h2 id="register-title" className="text-2xl font-black text-slate-900">
              Shop / Retailer Registration
            </h2>
            <p className="text-sm text-slate-500">
              Register a new shop to your assigned territory.
            </p>
          </div>
          <button
            disabled={saving}
            onClick={close}
            aria-label="Close"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-5" />
          </button>
        </header>
        <form onSubmit={submit} className="grid min-w-0 gap-5 p-5 sm:p-6 md:grid-cols-2">
          {errors.form && (
            <div
              role="alert"
              className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
            >
              {errors.form}
            </div>
          )}
          <FormInput
            label="Shop / Retailer Name"
            required
            value={form.name}
            onChange={set("name")}
            error={errors.name}
            placeholder="Enter shop name"
          />
          <FormInput
            label="Owner Name"
            required
            value={form.ownerName}
            onChange={set("ownerName")}
            error={errors.ownerName}
            placeholder="Enter owner name"
          />
          <FormInput
            label="Mobile Number"
            required
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            error={errors.phone}
            placeholder="+94771234567"
          />
          <FormInput
            label="Alternate Mobile"
            type="tel"
            value={form.alternateMobile}
            onChange={set("alternateMobile")}
            error={errors.alternateMobile}
            placeholder="Optional"
          />
          <FormInput
            label="NIC / Passport"
            value={form.nicNumber}
            onChange={set("nicNumber")}
            placeholder="Optional"
          />
          <FormInput
            label="Business Registration Number"
            value={form.brNumber}
            onChange={set("brNumber")}
            placeholder="Optional"
          />
          <FormInput
            label="Email"
            type="email"
            value={form.email}
            onChange={set("email")}
            error={errors.email}
            placeholder="Optional"
          />
          <FormInput
            label="Area / City"
            required
            value={form.city}
            onChange={set("city")}
            error={errors.city}
            placeholder="Enter city"
          />
          <label className="md:col-span-2">
            <FormLabel text="Address" required />
            <textarea
              value={form.address}
              onChange={set("address")}
              rows={3}
              placeholder="Enter full address"
              className="input w-full resize-y text-slate-900"
            />
            {errors.address && <FormError>{errors.address}</FormError>}
          </label>
          <div className="md:col-span-2 rounded-2xl border border-indigo-200/70 bg-[linear-gradient(135deg,rgba(238,242,255,.88),rgba(255,255,255,.62))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.9)] sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-bold text-slate-900">GPS Location</p>
                <p className="text-xs text-slate-600">
                  Enter coordinates manually or capture current position.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void locate()}
                disabled={locating}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                <LocateFixed className="h-4" />
                {locating ? "Locating…" : "Use current location"}
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput
                label="Latitude"
                type="number"
                step="any"
                value={form.latitude}
                onChange={set("latitude")}
                error={errors.latitude}
                placeholder="-90 to 90"
              />
              <FormInput
                label="Longitude"
                type="number"
                step="any"
                value={form.longitude}
                onChange={set("longitude")}
                error={errors.longitude}
                placeholder="-180 to 180"
              />
            </div>
          </div>
          <FormInput
            label="Credit Limit (LKR)"
            type="number"
            min="0"
            step="0.01"
            value={form.creditLimitLkr}
            onChange={set("creditLimitLkr")}
            error={errors.creditLimitLkr}
            placeholder="0"
          />
          <FormInput
            label="Payment Terms"
            value={form.paymentTerms}
            onChange={set("paymentTerms")}
            placeholder="e.g. Net 30 days"
          />
          <label>
            <FormLabel text="Status" />
            <select
              value={form.active}
              onChange={set("active")}
              className="input w-full text-slate-900"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <FormLabel text="Notes" />
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={4}
              placeholder="Additional notes or remarks"
              className="input w-full resize-y text-slate-900"
            />
          </label>
          <div className="md:col-span-2 rounded-2xl border border-indigo-200/70 bg-indigo-50/50 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-bold text-slate-900">Shop-front photo <span className="text-rose-500">*</span></p>
                <p className="text-xs text-slate-600">Use the phone camera or choose a clear image of the shop. This will be visible to your manager.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-500">
                <Camera className="h-4 w-4" />
                {shopPhoto ? "Retake photo" : "Open camera"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={selectShopPhoto}
                  className="sr-only"
                />
              </label>
            </div>
            {photoPreview ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-indigo-200 bg-white">
                <img src={photoPreview} alt="Shop-front preview" className="h-48 w-full object-cover" />
                <p className="px-3 py-2 text-xs font-semibold text-slate-600">{shopPhoto?.name}</p>
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-indigo-300 bg-white/70 px-4 py-6 text-center text-xs font-semibold text-slate-500">No shop photo captured yet.</p>
            )}
          </div>
          <footer className="sticky bottom-0 z-10 md:col-span-2 -mx-5 -mb-5 mt-2 flex justify-end gap-3 border-t border-white/70 bg-white/82 px-5 py-4 backdrop-blur-xl sm:-mx-6 sm:-mb-6 sm:px-6">
            <button
              type="button"
              disabled={saving}
              onClick={close}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-w-40 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? "Registering…" : "Register Shop"}
            </button>
          </footer>
        </form>
      </aside>
    </div>,
    document.body,
  );
};

const FormLabel = ({ text, required }: { text: string; required?: boolean }) => (
  <span className="mb-1.5 block text-xs font-bold text-slate-700">
    {text}
    {required && <span className="text-rose-500"> *</span>}
  </span>
);

const FormError = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-1 block text-xs font-semibold text-rose-600">{children}</span>
);

const FormInput = ({
  label,
  required,
  error,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
  error?: string;
}) => (
  <label>
    <FormLabel text={label} required={required} />
    <input
      {...p}
      aria-invalid={!!error}
      className={`input w-full text-slate-900 ${error ? "border-rose-400" : ""}`}
    />
    {error && <FormError>{error}</FormError>}
  </label>
);
