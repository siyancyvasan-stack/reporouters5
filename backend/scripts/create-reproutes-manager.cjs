const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    try {
        let [tenants] = await conn.execute('SELECT id FROM Tenant WHERE slug=?', ['reproutes']);
        let tenantId;
        if (tenants.length === 0) {
            tenantId = 't_' + Date.now();
            await conn.execute(
                'INSERT INTO Tenant (id, name, slug, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())',
                [tenantId, 'Reproutes Official', 'reproutes']
            );
        } else {
            tenantId = tenants[0].id;
        }

        await conn.execute('DELETE FROM User WHERE email=?', ['manager@reproutes.com']);
        
        const hash = await bcrypt.hash('password123', 12);
        await conn.execute(
            'INSERT INTO User (id, email, passwordHash, name, role, tenantId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            ['u_manager_real', 'manager@reproutes.com', hash, 'Reproutes Manager', 'MANAGER', tenantId, 'ACTIVE']
        );
        console.log('Successfully created manager@reproutes.com under reproutes tenant.');
    } catch(err) {
        console.error(err);
    } finally {
        await conn.end();
    }
}
run();
