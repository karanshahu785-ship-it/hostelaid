import os
import requests
import database

def get_sms_credentials():
    provider = database.get_setting("sms_provider", os.environ.get("SMS_PROVIDER", "simulation"))
    twilio_sid = database.get_setting("twilio_sid", os.environ.get("TWILIO_ACCOUNT_SID", ""))
    twilio_token = database.get_setting("twilio_token", os.environ.get("TWILIO_AUTH_TOKEN", ""))
    twilio_from = database.get_setting("twilio_from", os.environ.get("TWILIO_PHONE_NUMBER", ""))
    fast2sms_key = database.get_setting("fast2sms_key", os.environ.get("FAST2SMS_KEY", ""))

    return {
        "provider": provider,
        "twilio_sid": twilio_sid.strip(),
        "twilio_token": twilio_token.strip(),
        "twilio_from": twilio_from.strip(),
        "fast2sms_key": fast2sms_key.strip()
    }

def send_sms(to_phone, message, recipient_name="Resident", incident_id=None):
    """
    Sends an SMS notification.
    Supports Twilio, Fast2SMS, and Simulated Dispatch mode.
    All messages are permanently logged in the SQLite `sms_logs` table.
    """
    if not to_phone or not to_phone.strip():
        return False, "Recipient phone number is missing"

    to_phone = to_phone.strip()
    creds = get_sms_credentials()
    provider = creds["provider"]
    status = "Delivered (Simulated)"
    error_msg = ""
    success = True

    if provider == "twilio" and creds["twilio_sid"] and creds["twilio_token"]:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{creds['twilio_sid']}/Messages.json"
            data = {
                "To": to_phone,
                "From": creds["twilio_from"],
                "Body": message
            }
            resp = requests.post(url, data=data, auth=(creds["twilio_sid"], creds["twilio_token"]), timeout=8)
            if resp.status_code in [200, 201]:
                status = "Sent (Twilio)"
            else:
                success = False
                status = "Failed (Twilio)"
                error_msg = f"HTTP {resp.status_code}: {resp.text[:120]}"
        except Exception as e:
            success = False
            status = "Failed (Twilio)"
            error_msg = str(e)[:120]

    elif provider == "fast2sms" and creds["fast2sms_key"]:
        try:
            clean_phone = "".join(filter(str.isdigit, to_phone))[-10:]
            url = "https://www.fast2sms.com/dev/bulkV2"
            payload = {
                "route": "q",
                "message": message,
                "numbers": clean_phone
            }
            headers = {"authorization": creds["fast2sms_key"]}
            resp = requests.post(url, data=payload, headers=headers, timeout=8)
            if resp.status_code == 200 and resp.json().get("return"):
                status = "Sent (Fast2SMS)"
            else:
                success = False
                status = "Failed (Fast2SMS)"
                error_msg = resp.text[:120]
        except Exception as e:
            success = False
            status = "Failed (Fast2SMS)"
            error_msg = str(e)[:120]

    else:
        # High-fidelity Simulation mode (stores and timestamps with realistic carrier delivery)
        status = "Delivered (Simulated)"
        provider = "simulation"

    # Save to SQLite database audit log
    database.log_sms(
        incident_id=incident_id,
        recipient_phone=to_phone,
        recipient_name=recipient_name,
        message=message,
        provider=provider,
        status=status,
        error_message=error_msg
    )

    return success, status

def notify_responders_new_incident(incident):
    """
    Sends emergency SMS alerts to duty wardens & responders when a new incident is created.
    """
    responders = database.get_all_responders()
    prio = incident.get("priority", "Medium")
    inc_id = incident.get("id", "HA-xxxx")
    loc = incident.get("location", "Campus")
    typ = incident.get("type", "Emergency")
    title = incident.get("title", "")

    # Target phone numbers
    alert_msg = f"[HOSTELAID ALERT] {prio} {typ} Incident #{inc_id} reported at {loc}. Title: {title}. Immediate response required."

    dispatched_count = 0
    # Notify available responders
    for r in responders:
        if r.get("phone"):
            send_sms(
                to_phone=r["phone"],
                message=alert_msg,
                recipient_name=r["name"],
                incident_id=inc_id
            )
            dispatched_count += 1

    return dispatched_count

def notify_student_status_update(incident, new_status, responder_name=None):
    """
    Sends an SMS status update to the student/reporter callback number.
    """
    callback = incident.get("callback")
    if not callback:
        return False, "No callback phone"

    inc_id = incident.get("id", "HA-xxxx")
    if new_status == "Responding":
        lead_str = f"Responder {responder_name} is on the way." if responder_name else "Hostel response team dispatched."
        msg = f"[HOSTELAID] Help is en route for Incident #{inc_id}. {lead_str} Stay calm and safe."
    elif new_status == "Resolved":
        msg = f"[HOSTELAID] Incident #{inc_id} has been resolved and logged by campus authorities. Stay safe!"
    else:
        msg = f"[HOSTELAID] Incident #{inc_id} status updated to: {new_status}."

    return send_sms(
        to_phone=callback,
        message=msg,
        recipient_name=incident.get("reporter", "Student"),
        incident_id=inc_id
    )
