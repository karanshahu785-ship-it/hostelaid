import sqlite3
import os
import json
import hashlib
import secrets
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hostelaid.db")

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    ).hex()
    return hashed, salt

def verify_password(password, stored_hash, stored_salt):
    hashed, _ = hash_password(password, stored_salt)
    return secrets.compare_digest(hashed, stored_hash)

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        phone TEXT,
        hostel_block TEXT,
        room_number TEXT,
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        medical_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Incidents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        desc TEXT NOT NULL,
        location TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Open',
        reporter TEXT,
        reporter_id INTEGER,
        people TEXT,
        callback TEXT,
        assigned_to TEXT,
        ai_rationale TEXT,
        first_aid_guidance TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Check and add reporter_id column if missing from earlier table
    cursor.execute("PRAGMA table_info(incidents)")
    cols = [col['name'] for col in cursor.fetchall()]
    if 'reporter_id' not in cols:
        try:
            cursor.execute("ALTER TABLE incidents ADD COLUMN reporter_id INTEGER")
        except Exception:
            pass

    # Incident actions / timeline table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        action_text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
    )
    """)

    # Responders table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS responders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        initials TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'Available',
        skills TEXT NOT NULL,
        phone TEXT
    )
    """)

    # SMS logs table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sms_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT,
        recipient_phone TEXT NOT NULL,
        recipient_name TEXT,
        message TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Settings / config table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)

    conn.commit()

    # Seed default users if empty
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        seed_users = [
            ('warden@hostel.edu', 'warden123', 'Aarav Sharma', 'warden', '+91 98765 43210', 'Block A', 'Warden Office', 'Campus Security', '+91 98765 43200', 'None'),
            ('student@hostel.edu', 'student123', 'Rahul Verma', 'student', '+91 98765 11111', 'Block A · Ground floor', 'Room 204', 'Suresh Verma (Father)', '+91 98765 99999', 'Mild Asthma, Blood Group B+'),
            ('doctor@hostel.edu', 'doctor123', 'Dr. Meera Joshi', 'responder', '+91 98765 43211', 'Health Center', 'Clinic 1', 'Chief Medical Officer', '+91 98765 43222', 'First Aid & Trauma Care')
        ]
        for email, pwd, name, role, phone, block, room, ec_name, ec_phone, med in seed_users:
            h, s = hash_password(pwd)
            cursor.execute("""
            INSERT INTO users (email, password_hash, salt, name, role, phone, hostel_block, room_number, emergency_contact_name, emergency_contact_phone, medical_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (email, h, s, name, role, phone, block, room, ec_name, ec_phone, med))
        conn.commit()

    # Seed initial responders if empty
    cursor.execute("SELECT COUNT(*) FROM responders")
    if cursor.fetchone()[0] == 0:
        seed_responders = [
            ('R-1', 'Aarav Sharma', 'Warden · Block A', 'AS', 'Available', 'Incident lead · Campus coordination', '+91 98765 43210'),
            ('R-2', 'Dr. Meera Joshi', 'Medical responder', 'MJ', 'Available', 'Medical support · First aid', '+91 98765 43211'),
            ('R-3', 'Rohan Patil', 'Campus security', 'RP', 'Available', 'Access control · Safety', '+91 98765 43212'),
            ('R-4', 'Nisha Verma', 'Floor representative', 'NV', 'Available', 'Resident check-in · Communication', '+91 98765 43213'),
            ('R-5', 'Kabir Singh', 'Warden · Block B', 'KS', 'On incident', 'Evacuation · Building coordination', '+91 98765 43214'),
            ('R-6', 'Ananya Rao', 'First-aid volunteer', 'AR', 'Available', 'First-aid trained volunteer', '+91 98765 43215')
        ]
        cursor.executemany("""
        INSERT INTO responders (id, name, role, initials, state, skills, phone)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, seed_responders)
        conn.commit()

    # Seed initial incidents if empty
    cursor.execute("SELECT COUNT(*) FROM incidents")
    if cursor.fetchone()[0] == 0:
        seed_incidents = [
            (
                'HA-1042', 'Medical', 'Student feeling dizzy',
                'Student reports dizziness near the common room. Needs a welfare check.',
                'Block A · Ground floor', 'High', 'Open', 'Rahul Verma (Room 204)', 2, '1 person', '+91 98765 11111',
                'Aarav Sharma', 'Dizziness in common area may escalate to fainting; high priority check needed.',
                'Ensure student sits down safely with head between knees or lies flat; provide water.'
            ),
            (
                'HA-1041', 'Safety', 'Unknown person near entrance',
                'Student reported an unfamiliar person attempting to enter the hostel.',
                'Hostel entrance', 'Medium', 'Responding', 'Resident student', None, '1 person', '+91 98765 22222',
                'Rohan Patil', 'Potential trespass or security breach; warden and security notified.',
                'Keep building doors locked and stay within well-lit populated areas.'
            ),
            (
                'HA-1039', 'Medical', 'Minor sports injury',
                'Student twisted an ankle at the sports ground. First-aid support requested.',
                'Sports ground', 'Low', 'Resolved', 'Sports volunteer', None, '1 person', '+91 98765 33333',
                'Dr. Meera Joshi', 'Localized musculoskeletal strain without immediate hazard.',
                'R.I.C.E. protocol: Rest, Ice, Compression, Elevation.'
            )
        ]
        cursor.executemany("""
        INSERT INTO incidents (
            id, type, title, desc, location, priority, status, reporter, reporter_id, people, callback,
            assigned_to, ai_rationale, first_aid_guidance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, seed_incidents)

        seed_actions = [
            ('HA-1042', 'Incident received and logged into system'),
            ('HA-1042', 'Warden notification sent to Aarav Sharma'),
            ('HA-1041', 'Security team assigned: Rohan Patil'),
            ('HA-1041', 'Entrance being actively checked'),
            ('HA-1039', 'First-aid responder Dr. Meera Joshi attended'),
            ('HA-1039', 'Ice pack applied and incident resolved')
        ]
        cursor.executemany("""
        INSERT INTO actions (incident_id, action_text) VALUES (?, ?)
        """, seed_actions)
        conn.commit()

    conn.close()

# ----------------- User Authentication & Management -----------------
def create_user(email, password, name, role='student', phone='', hostel_block='', room_number='', emergency_contact_name='', emergency_contact_phone='', medical_notes=''):
    conn = get_db_connection()
    h, s = hash_password(password)
    try:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO users (email, password_hash, salt, name, role, phone, hostel_block, room_number, emergency_contact_name, emergency_contact_phone, medical_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (email.lower().strip(), h, s, name.strip(), role, phone, hostel_block, room_number, emergency_contact_name, emergency_contact_phone, medical_notes))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return get_user_by_id(user_id)
    except sqlite3.IntegrityError:
        conn.close()
        return None

def authenticate_user(email, password):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    conn.close()
    if not row:
        return None
    if verify_password(password, row['password_hash'], row['salt']):
        u = dict(row)
        del u['password_hash']
        del u['salt']
        return u
    return None

def get_user_by_id(user_id):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        return None
    u = dict(row)
    del u['password_hash']
    del u['salt']
    return u

def get_user_by_email(email):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    conn.close()
    if not row:
        return None
    u = dict(row)
    del u['password_hash']
    del u['salt']
    return u

def get_all_users():
    conn = get_db_connection()
    rows = conn.execute("SELECT id, email, name, role, phone, hostel_block, room_number, emergency_contact_name, emergency_contact_phone, medical_notes, created_at FROM users ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_user_profile(user_id, data):
    conn = get_db_connection()
    user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    fields = []
    params = []
    for k in ['name', 'phone', 'hostel_block', 'room_number', 'emergency_contact_name', 'emergency_contact_phone', 'medical_notes']:
        if k in data and data[k] is not None:
            fields.append(f"{k} = ?")
            params.append(data[k])
    if fields:
        params.append(user_id)
        sql = f"UPDATE users SET {', '.join(fields)} WHERE id = ?"
        conn.execute(sql, params)
        conn.commit()
    conn.close()

    # If the user is a warden or responder, sync to emergency contacts & responders roster
    if user_row:
        new_name = data.get('name', user_row['name'])
        new_phone = data.get('phone', user_row['phone'])
        if user_row['role'] == 'warden' and new_phone:
            set_duty_warden_contact(new_name, new_phone)
        elif user_row['role'] == 'responder' and new_phone:
            conn_resp = get_db_connection()
            conn_resp.execute("UPDATE responders SET phone = ?, name = ? WHERE name = ? OR role LIKE '%Medical%'", (new_phone, new_name, user_row['name']))
            conn_resp.commit()
            conn_resp.close()

    return get_user_by_id(user_id)

# ----------------- SMS Logs Management -----------------
def log_sms(incident_id, recipient_phone, recipient_name, message, provider, status, error_message=''):
    conn = get_db_connection()
    conn.execute("""
    INSERT INTO sms_logs (incident_id, recipient_phone, recipient_name, message, provider, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (incident_id, recipient_phone, recipient_name, message, provider, status, error_message))
    conn.commit()
    conn.close()

def get_sms_logs(limit=50):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ----------------- Settings / Config -----------------
def get_setting(key, default=None):
    conn = get_db_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row['value'] if row else default

def set_setting(key, value):
    conn = get_db_connection()
    conn.execute("""
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    """, (key, value))
    conn.commit()
    conn.close()

# ----------------- Incidents Management -----------------
def get_all_incidents(status_filter=None, search_query=None, reporter_id=None, role=None, type_filter=None):
    conn = get_db_connection()
    query = """
    SELECT i.*, 
           u.medical_notes as reporter_medical_notes,
           u.emergency_contact_name as reporter_ec_name,
           u.emergency_contact_phone as reporter_ec_phone,
           u.room_number as reporter_room
    FROM incidents i
    LEFT JOIN users u ON (i.reporter_id = u.id OR (i.reporter LIKE '%' || u.name || '%' AND u.name != ''))
    WHERE 1=1
    """
    params = []

    # If student, only show incidents created by this student
    if role == 'student' and reporter_id:
        query += " AND (i.reporter_id = ? OR i.reporter LIKE '%' || (SELECT name FROM users WHERE id = ?) || '%')"
        params.extend([reporter_id, reporter_id])

    # If type filter specified (e.g. Doctor viewing Medical only)
    if type_filter and type_filter != 'All':
        query += " AND i.type = ?"
        params.append(type_filter)

    if status_filter and status_filter != 'All':
        query += " AND i.status = ?"
        params.append(status_filter)

    if search_query:
        query += " AND (i.id LIKE ? OR i.title LIKE ? OR i.desc LIKE ? OR i.location LIKE ? OR i.type LIKE ? OR i.reporter LIKE ?)"
        term = f"%{search_query}%"
        params.extend([term, term, term, term, term, term])

    query += " ORDER BY i.created_at DESC"
    rows = conn.execute(query, params).fetchall()

    incidents = []
    for r in rows:
        inc = dict(r)
        actions = conn.execute(
            "SELECT action_text, created_at FROM actions WHERE incident_id = ? ORDER BY id ASC",
            (inc['id'],)
        ).fetchall()
        inc['actions'] = [a['action_text'] for a in actions]
        incidents.append(inc)

    conn.close()
    return incidents

def get_incident_by_id(incident_id):
    conn = get_db_connection()
    query = """
    SELECT i.*, 
           u.medical_notes as reporter_medical_notes,
           u.emergency_contact_name as reporter_ec_name,
           u.emergency_contact_phone as reporter_ec_phone,
           u.room_number as reporter_room
    FROM incidents i
    LEFT JOIN users u ON (i.reporter_id = u.id OR (i.reporter LIKE '%' || u.name || '%' AND u.name != ''))
    WHERE i.id = ?
    """
    row = conn.execute(query, (incident_id,)).fetchone()
    if not row:
        conn.close()
        return None
    inc = dict(row)
    actions = conn.execute(
        "SELECT id, action_text, created_at FROM actions WHERE incident_id = ? ORDER BY id ASC",
        (incident_id,)
    ).fetchall()
    inc['actions'] = [dict(a) for a in actions]
    conn.close()
    return inc

def create_incident(data):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM incidents WHERE id LIKE 'HA-%' ORDER BY rowid DESC LIMIT 1")
    last_row = cursor.fetchone()
    next_num = 1043
    if last_row:
        try:
            num = int(last_row['id'].replace('HA-', ''))
            next_num = max(next_num, num + 1)
        except Exception:
            pass
    new_id = f"HA-{next_num}"

    title = data.get('title')
    desc = data.get('desc', '')
    if not title:
        title = desc[:45] + '...' if len(desc) > 48 else desc

    cursor.execute("""
    INSERT INTO incidents (
        id, type, title, desc, location, priority, status, reporter, reporter_id, people, callback,
        assigned_to, ai_rationale, first_aid_guidance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        data.get('type', 'Medical'),
        title,
        desc,
        data.get('location', 'Unspecified'),
        data.get('priority', 'Medium'),
        data.get('status', 'Open'),
        data.get('reporter', 'Anonymous reporter'),
        data.get('reporter_id'),
        data.get('people', '1 person'),
        data.get('callback', ''),
        data.get('assigned_to', ''),
        data.get('ai_rationale', ''),
        data.get('first_aid_guidance', '')
    ))

    cursor.execute("""
    INSERT INTO actions (incident_id, action_text) VALUES (?, ?)
    """, (new_id, f"Incident created · Priority: {data.get('priority', 'Medium')}"))

    conn.commit()
    conn.close()
    return get_incident_by_id(new_id)

def update_incident(incident_id, updates):
    conn = get_db_connection()
    fields = []
    params = []
    for k in ['status', 'priority', 'assigned_to', 'title', 'desc', 'location']:
        if k in updates:
            fields.append(f"{k} = ?")
            params.append(updates[k])

    if not fields:
        conn.close()
        return get_incident_by_id(incident_id)

    fields.append("updated_at = CURRENT_TIMESTAMP")
    params.append(incident_id)

    sql = f"UPDATE incidents SET {', '.join(fields)} WHERE id = ?"
    conn.execute(sql, params)
    conn.commit()
    conn.close()
    return get_incident_by_id(incident_id)

def add_incident_action(incident_id, action_text):
    conn = get_db_connection()
    conn.execute("""
    INSERT INTO actions (incident_id, action_text) VALUES (?, ?)
    """, (incident_id, action_text))
    conn.commit()
    conn.close()
    return get_incident_by_id(incident_id)

def get_all_responders():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM responders ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_responder_status(responder_id, state):
    conn = get_db_connection()
    conn.execute("UPDATE responders SET state = ? WHERE id = ? OR name = ?", (state, responder_id, responder_id))
    conn.commit()
    conn.close()

def update_responder(responder_id, data):
    conn = get_db_connection()
    fields = []
    params = []
    for k in ['name', 'role', 'phone', 'skills', 'state']:
        if k in data and data[k] is not None:
            fields.append(f"{k} = ?")
            params.append(data[k])

    if 'name' in data and data['name']:
        parts = data['name'].strip().split()
        initials = "".join([p[0] for p in parts[:2]]).upper() or 'R'
        fields.append("initials = ?")
        params.append(initials)

    if fields:
        params.append(responder_id)
        params.append(responder_id)
        sql = f"UPDATE responders SET {', '.join(fields)} WHERE id = ? OR name = ?"
        conn.execute(sql, params)
        conn.commit()
    conn.close()
    return get_all_responders()

def create_responder(data):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM responders ORDER BY rowid DESC LIMIT 1")
    last_row = cursor.fetchone()
    next_num = 7
    if last_row and last_row['id'].startswith('R-'):
        try:
            next_num = int(last_row['id'].replace('R-', '')) + 1
        except Exception:
            pass
    new_id = f"R-{next_num}"
    name = data.get('name', 'Responder')
    parts = name.strip().split()
    initials = "".join([p[0] for p in parts[:2]]).upper() or 'R'
    cursor.execute("""
    INSERT INTO responders (id, name, role, initials, state, skills, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        name,
        data.get('role', 'Emergency Staff'),
        initials,
        data.get('state', 'Available'),
        data.get('skills', 'Campus responder'),
        data.get('phone', '')
    ))
    conn.commit()
    conn.close()
    return get_all_responders()

def delete_responder(responder_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM responders WHERE id = ? OR name = ?", (responder_id, responder_id))
    conn.commit()
    conn.close()
    return get_all_responders()

def get_duty_warden_contact():
    saved_phone = get_setting('duty_warden_phone')
    saved_name = get_setting('duty_warden_name')
    if saved_phone and saved_name:
        return {"name": saved_name, "phone": saved_phone}

    conn = get_db_connection()
    row = conn.execute("SELECT name, phone FROM responders WHERE role LIKE '%Warden%' LIMIT 1").fetchone()
    if row and row['phone']:
        conn.close()
        return {"name": row['name'], "phone": row['phone']}

    row_u = conn.execute("SELECT name, phone FROM users WHERE role = 'warden' LIMIT 1").fetchone()
    conn.close()
    if row_u and row_u['phone']:
        return {"name": row_u['name'], "phone": row_u['phone']}

    return {"name": "Aarav Sharma (Warden)", "phone": "+91 98765 43210"}

def set_duty_warden_contact(name, phone):
    set_setting('duty_warden_name', name.strip())
    set_setting('duty_warden_phone', phone.strip())
    conn = get_db_connection()
    conn.execute("UPDATE responders SET phone = ?, name = ? WHERE role LIKE '%Warden%' OR id = 'R-1'", (phone.strip(), name.strip()))
    conn.commit()
    conn.close()
    return {"name": name, "phone": phone}

def get_system_stats(reporter_id=None, role=None):
    conn = get_db_connection()
    if role == 'student' and reporter_id:
        total_open = conn.execute("SELECT COUNT(*) FROM incidents WHERE status != 'Resolved' AND (reporter_id = ? OR reporter LIKE '%' || (SELECT name FROM users WHERE id = ?) || '%')", (reporter_id, reporter_id)).fetchone()[0]
        total_resolved = conn.execute("SELECT COUNT(*) FROM incidents WHERE status = 'Resolved' AND (reporter_id = ? OR reporter LIKE '%' || (SELECT name FROM users WHERE id = ?) || '%')", (reporter_id, reporter_id)).fetchone()[0]
    else:
        total_open = conn.execute("SELECT COUNT(*) FROM incidents WHERE status != 'Resolved'").fetchone()[0]
        total_resolved = conn.execute("SELECT COUNT(*) FROM incidents WHERE status = 'Resolved'").fetchone()[0]

    medical_open = conn.execute("SELECT COUNT(*) FROM incidents WHERE type = 'Medical' AND status != 'Resolved'").fetchone()[0]
    available_responders = conn.execute("SELECT COUNT(*) FROM responders WHERE state = 'Available'").fetchone()[0]
    total_responders = conn.execute("SELECT COUNT(*) FROM responders").fetchone()[0]
    total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    total_sms = conn.execute("SELECT COUNT(*) FROM sms_logs").fetchone()[0]
    conn.close()
    return {
        "open_incidents": total_open,
        "resolved_incidents": total_resolved,
        "medical_open": medical_open,
        "available_responders": available_responders,
        "total_responders": total_responders,
        "readiness_percent": round((available_responders / total_responders * 100)) if total_responders else 0,
        "avg_response_time": "04m 18s",
        "total_users": total_users,
        "total_sms_sent": total_sms
    }
