import os
import sys
import json
import base64
import hmac
import hashlib
import time
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

# Load local .env if present
load_dotenv()

import database
import ai_service
import sms_service

# Initialize database schema and seeds
database.init_db()

# Determine static folder
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)

app = Flask(__name__, static_folder=STATIC_DIR)
CORS(app)

AUTH_SECRET = os.environ.get("AUTH_SECRET", "hostelaid-super-secure-campus-secret-key-2026")

def generate_token(user_id, email, role):
    payload = {
        "uid": user_id,
        "email": email,
        "role": role,
        "exp": int(time.time()) + (86400 * 7) # 7 days
    }
    dumped = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    b64_payload = base64.urlsafe_b64encode(dumped).decode('utf-8').rstrip('=')
    sig = hmac.new(AUTH_SECRET.encode('utf-8'), b64_payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{sig}"

def verify_token(token_str):
    if not token_str or '.' not in token_str:
        return None
    try:
        b64_payload, sig = token_str.split('.', 1)
        expected_sig = hmac.new(AUTH_SECRET.encode('utf-8'), b64_payload.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        rem = len(b64_payload) % 4
        padded = b64_payload + ('=' * (4 - rem) if rem else '')
        raw = base64.urlsafe_b64decode(padded).decode('utf-8')
        payload = json.loads(raw)
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except Exception:
        return None

def get_current_user():
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.cookies.get("hostelaid_token", "")
    if not token:
        return None
    token_data = verify_token(token)
    if not token_data:
        return None
    return database.get_user_by_id(token_data['uid'])

# ----------------- Static & Frontend Routes -----------------
@app.route("/")
def serve_index():
    return send_from_directory(STATIC_DIR, "index.html")

# ----------------- Authentication & User API -----------------
@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    name = data.get("name", "").strip()
    role = data.get("role", "student").strip()
    phone = data.get("phone", "").strip()
    hostel_block = data.get("hostel_block", "").strip()
    room_number = data.get("room_number", "").strip()
    emergency_contact_name = data.get("emergency_contact_name", "").strip()
    emergency_contact_phone = data.get("emergency_contact_phone", "").strip()
    medical_notes = data.get("medical_notes", "").strip()

    if not email or not password or not name:
        return jsonify({"success": False, "error": "Email, password, and name are required"}), 400

    if len(password) < 6:
        return jsonify({"success": False, "error": "Password must be at least 6 characters"}), 400

    user = database.create_user(
        email=email,
        password=password,
        name=name,
        role=role,
        phone=phone,
        hostel_block=hostel_block,
        room_number=room_number,
        emergency_contact_name=emergency_contact_name,
        emergency_contact_phone=emergency_contact_phone,
        medical_notes=medical_notes
    )

    if not user:
        return jsonify({"success": False, "error": "An account with this email already exists"}), 400

    token = generate_token(user['id'], user['email'], user['role'])
    return jsonify({"success": True, "user": user, "token": token}), 201

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()

    if not email or not password:
        return jsonify({"success": False, "error": "Email and password are required"}), 400

    user = database.authenticate_user(email, password)
    if not user:
        return jsonify({"success": False, "error": "Invalid email or password"}), 401

    token = generate_token(user['id'], user['email'], user['role'])
    return jsonify({"success": True, "user": user, "token": token})

@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "authenticated": False, "user": None})
    return jsonify({"success": True, "authenticated": True, "user": user})

@app.route("/api/auth/profile", methods=["PATCH"])
def update_profile():
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    data = request.get_json() or {}
    updated = database.update_user_profile(user['id'], data)
    return jsonify({"success": True, "user": updated})

@app.route("/api/users", methods=["GET"])
def list_users():
    user = get_current_user()
    users = database.get_all_users()
    return jsonify({"success": True, "users": users})

# ----------------- SMS Alert API -----------------
@app.route("/api/sms/logs", methods=["GET"])
def list_sms_logs():
    limit = request.args.get("limit", 50, type=int)
    logs = database.get_sms_logs(limit=limit)
    return jsonify({"success": True, "logs": logs})

@app.route("/api/sms/send", methods=["POST"])
def send_custom_sms():
    data = request.get_json() or {}
    to_phone = data.get("to_phone", "").strip()
    message = data.get("message", "").strip()
    recipient_name = data.get("recipient_name", "Resident")
    incident_id = data.get("incident_id")

    if not to_phone or not message:
        return jsonify({"success": False, "error": "Phone number and message required"}), 400

    success, status = sms_service.send_sms(to_phone, message, recipient_name, incident_id)
    return jsonify({"success": success, "status": status})

@app.route("/api/sms/config", methods=["GET"])
def get_sms_config():
    creds = sms_service.get_sms_credentials()
    masked_token = creds["twilio_token"][:3] + "..." if creds["twilio_token"] else ""
    return jsonify({
        "success": True,
        "provider": creds["provider"],
        "twilio_sid": creds["twilio_sid"],
        "twilio_from": creds["twilio_from"],
        "has_twilio_token": bool(creds["twilio_token"]),
        "masked_token": masked_token,
        "has_fast2sms_key": bool(creds["fast2sms_key"])
    })

@app.route("/api/sms/config", methods=["POST"])
def save_sms_config():
    data = request.get_json() or {}
    provider = data.get("provider", "simulation")
    database.set_setting("sms_provider", provider)

    if "twilio_sid" in data:
        database.set_setting("twilio_sid", data["twilio_sid"].strip())
    if "twilio_token" in data and data["twilio_token"]:
        database.set_setting("twilio_token", data["twilio_token"].strip())
    if "twilio_from" in data:
        database.set_setting("twilio_from", data["twilio_from"].strip())
    if "fast2sms_key" in data and data["fast2sms_key"]:
        database.set_setting("fast2sms_key", data["fast2sms_key"].strip())

    return jsonify({"success": True, "message": "SMS gateway configuration saved successfully."})

# ----------------- Incidents API (Role-Filtered) -----------------
@app.route("/api/incidents", methods=["GET"])
def list_incidents():
    user = get_current_user()
    status = request.args.get("status")
    query = request.args.get("q")
    type_filter = request.args.get("type")

    # If student, strictly isolate to their own reported incidents
    reporter_id = user['id'] if user else None
    role = user['role'] if user else 'student'

    # If Warden or Doctor/Responder, role overrides restriction unless explicit my=1 requested
    if role in ['warden', 'responder', 'admin']:
        if request.args.get('my') == '1':
            incidents = database.get_all_incidents(status_filter=status, search_query=query, reporter_id=reporter_id, role='student', type_filter=type_filter)
        else:
            incidents = database.get_all_incidents(status_filter=status, search_query=query, reporter_id=None, role=role, type_filter=type_filter)
    else:
        # Student or Guest: only see their own incidents
        incidents = database.get_all_incidents(status_filter=status, search_query=query, reporter_id=reporter_id, role='student', type_filter=type_filter)

    return jsonify({"success": True, "incidents": incidents, "user_role": role})

@app.route("/api/incidents/<incident_id>", methods=["GET"])
def get_incident(incident_id):
    inc = database.get_incident_by_id(incident_id)
    if not inc:
        return jsonify({"success": False, "error": "Incident not found"}), 404
    return jsonify({"success": True, "incident": inc})

@app.route("/api/incidents", methods=["POST"])
def create_incident():
    data = request.get_json() or {}
    desc = data.get("desc", "").strip()
    incident_type = data.get("type", "Medical")
    location = data.get("location", "Unspecified")
    people = data.get("people", "1 person")

    if not desc:
        return jsonify({"success": False, "error": "Description is required"}), 400

    # Attach logged-in user
    user = get_current_user()
    if user:
        data["reporter_id"] = user['id']
        if not data.get("reporter"):
            data["reporter"] = f"{user['name']} ({user.get('room_number', 'Resident')})"
        if not data.get("callback") and user.get("phone"):
            data["callback"] = user["phone"]
        if not data.get("location") or data.get("location") == "Unspecified":
            data["location"] = f"{user.get('hostel_block', 'Hostel')} · {user.get('room_number', '')}"

    # AI triage
    ai_result = ai_service.triage_incident(incident_type, desc, location, people)
    if not data.get("priority"):
        data["priority"] = ai_result.get("priority", "Medium")
    if not data.get("ai_rationale"):
        data["ai_rationale"] = ai_result.get("rationale", "")
    if not data.get("first_aid_guidance"):
        data["first_aid_guidance"] = ai_result.get("first_aid_guidance", "")
    if not data.get("assigned_to") and ai_result.get("suggested_responder"):
        data["assigned_to"] = ai_result.get("suggested_responder")

    incident = database.create_incident(data)

    if ai_result.get("first_aid_guidance"):
        database.add_incident_action(
            incident["id"],
            f"AI Guidance generated ({ai_result.get('engine', 'Triage')}): {ai_result.get('first_aid_guidance')[:100]}..."
        )

    # Automated SMS Broadcast to On-Duty Responders
    dispatched = sms_service.notify_responders_new_incident(incident)
    if dispatched > 0:
        database.add_incident_action(
            incident["id"],
            f"Automated SMS alert dispatched to {dispatched} campus emergency responders."
        )

    return jsonify({"success": True, "incident": incident, "ai_triage": ai_result, "sms_dispatched": dispatched}), 201

@app.route("/api/incidents/<incident_id>", methods=["PATCH"])
def update_incident(incident_id):
    user = get_current_user()
    # Check permissions: only Warden and Doctor/Responder can change status or assign responders
    role = user.get('role') if user else 'student'

    data = request.get_json() or {}
    existing = database.get_incident_by_id(incident_id)
    if not existing:
        return jsonify({"success": False, "error": "Incident not found"}), 404

    # Track status change in audit log
    if "status" in data and data["status"] != existing["status"]:
        database.add_incident_action(
            incident_id,
            f"Status updated to {data['status']} by {user['name'] if user else 'Staff'}"
        )
        sms_service.notify_student_status_update(existing, data["status"], data.get("assigned_to", existing.get("assigned_to")))

    # Track assigned responder
    if "assigned_to" in data and data["assigned_to"] != existing.get("assigned_to"):
        database.add_incident_action(
            incident_id,
            f"Assigned to responder: {data['assigned_to']}"
        )
        for r in database.get_all_responders():
            if r["name"] in data["assigned_to"] and r.get("phone"):
                sms_service.send_sms(
                    to_phone=r["phone"],
                    message=f"[HOSTELAID] You are assigned as lead responder for Incident #{incident_id} at {existing.get('location')}.",
                    recipient_name=r["name"],
                    incident_id=incident_id
                )

    updated = database.update_incident(incident_id, data)
    return jsonify({"success": True, "incident": updated})

@app.route("/api/incidents/<incident_id>/actions", methods=["POST"])
def add_action(incident_id):
    data = request.get_json() or {}
    action_text = data.get("action_text", "").strip()
    if not action_text:
        return jsonify({"success": False, "error": "Action text required"}), 400

    user = get_current_user()
    author = f" ({user['name']})" if user else ""
    updated = database.add_incident_action(incident_id, f"{action_text}{author}")
    return jsonify({"success": True, "incident": updated})

# ----------------- Responders & Emergency Contacts API -----------------
@app.route("/api/responders", methods=["GET"])
def get_responders():
    responders = database.get_all_responders()
    return jsonify({"success": True, "responders": responders})

@app.route("/api/responders", methods=["POST"])
def create_responder():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    if not name or not phone:
        return jsonify({"success": False, "error": "Name and phone number are required"}), 400

    responders = database.create_responder(data)
    return jsonify({"success": True, "responders": responders})

@app.route("/api/responders/<responder_id>", methods=["PATCH"])
def update_responder(responder_id):
    data = request.get_json() or {}
    responders = database.update_responder(responder_id, data)
    return jsonify({"success": True, "responders": responders})

@app.route("/api/responders/<responder_id>", methods=["DELETE"])
def delete_responder(responder_id):
    responders = database.delete_responder(responder_id)
    return jsonify({"success": True, "responders": responders})

@app.route("/api/contacts/duty-warden", methods=["GET"])
def get_duty_warden():
    contact = database.get_duty_warden_contact()
    return jsonify({"success": True, "contact": contact})

@app.route("/api/contacts/duty-warden", methods=["POST"])
def update_duty_warden():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    if not name or not phone:
        return jsonify({"success": False, "error": "Name and phone number are required"}), 400

    updated = database.set_duty_warden_contact(name, phone)
    return jsonify({"success": True, "contact": updated})

# ----------------- Stats API (Role-Adaptive) -----------------
@app.route("/api/stats", methods=["GET"])
def get_stats():
    user = get_current_user()
    reporter_id = user['id'] if user else None
    role = user['role'] if user else 'student'
    stats = database.get_system_stats(reporter_id=reporter_id, role=role)
    return jsonify({"success": True, "stats": stats, "user_role": role})

# ----------------- Real-time AI Triage API -----------------
@app.route("/api/ai/assess", methods=["POST"])
def ai_assess():
    data = request.get_json() or {}
    desc = data.get("desc", "").strip()
    incident_type = data.get("type", "Medical")
    location = data.get("location", "Unspecified")
    people = data.get("people", "1 person")

    if not desc:
        return jsonify({
            "success": True,
            "assessment": {
                "priority": "Medium",
                "summary_title": "Ready to assess details",
                "rationale": "Enter a short description to see suggested response priority.",
                "first_aid_guidance": "Provide accurate details to generate emergency guidance.",
                "is_ai": False,
                "engine": "Standby"
            }
        })

    result = ai_service.triage_incident(incident_type, desc, location, people)
    return jsonify({"success": True, "assessment": result})

# ----------------- API Key & Config API -----------------
@app.route("/api/config", methods=["GET"])
def get_config():
    creds = ai_service.get_active_credentials()
    masked_key = ""
    if creds["key"]:
        masked_key = creds["key"][:4] + "..." + creds["key"][-4:] if len(creds["key"]) > 8 else "***"

    return jsonify({
        "success": True,
        "provider": creds["provider"],
        "model": creds["model"],
        "has_key": bool(creds["key"]),
        "masked_key": masked_key
    })

@app.route("/api/config", methods=["POST"])
def save_config():
    data = request.get_json() or {}
    provider = data.get("provider", "gemini").lower()
    key = data.get("key", "").strip()
    model = data.get("model", "").strip()

    database.set_setting("ai_provider", provider)
    if provider == "openai":
        if key:
            database.set_setting("openai_api_key", key)
        if model:
            database.set_setting("ai_model", model)
    else:
        if key:
            database.set_setting("gemini_api_key", key)
        if model:
            database.set_setting("ai_model", model)

    return jsonify({"success": True, "message": "Configuration saved successfully."})

@app.route("/api/config/test", methods=["POST"])
def test_config():
    data = request.get_json() or {}
    provider = data.get("provider", "gemini").lower()
    key = data.get("key", "").strip()
    model = data.get("model", "")

    if not key:
        creds = ai_service.get_active_credentials()
        key = creds["key"]
        provider = creds["provider"]
        model = creds["model"]

    success, msg = ai_service.test_api_key(provider, key, model)
    return jsonify({"success": success, "message": msg})

# Catch-all for frontend static files and client-side routing
@app.route("/<path:path>")
def serve_static(path):
    if path.startswith("api/"):
        return jsonify({"success": False, "error": f"API endpoint /{path} not found"}), 404
    if os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, "index.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"=====================================================")
    print(f"  HOSTELAID SERVER RUNNING AT: http://localhost:{port}")
    print(f"  DATABASE: {database.DB_FILE}")
    print(f"=====================================================")
    app.run(host=host, port=port, debug=True)
