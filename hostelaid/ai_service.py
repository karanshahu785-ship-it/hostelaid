import os
import json
import re
import requests
import database

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

def get_active_credentials():
    provider = database.get_setting("ai_provider", os.environ.get("AI_PROVIDER", "gemini"))
    model = database.get_setting("ai_model", os.environ.get("AI_MODEL", "gemini-2.5-flash"))
    
    if provider == "openai":
        key = database.get_setting("openai_api_key", os.environ.get("OPENAI_API_KEY", ""))
    else:
        key = database.get_setting("gemini_api_key", os.environ.get("GEMINI_API_KEY", os.environ.get("GOOGLE_API_KEY", "")))
        
    return {
        "provider": provider,
        "key": key.strip() if key else "",
        "model": model.strip() if model else ("gemini-2.5-flash" if provider == "gemini" else "gpt-4o-mini")
    }

def rule_based_fallback(incident_type, desc, location, people):
    text = desc.lower()
    
    # Priority determination
    is_high = bool(re.search(r'\b(unconscious|fainted|collapse|not breathing|bleeding heavily|head injury|severe|trapped|fire|smoke|explosion|burns|poison|chest pain|stroke|seizure|choking|asthma attack)\b', text))
    is_low = bool(re.search(r'\b(minor|small cut|mild|stable|bruise|sprain|twisted ankle|lost key|headache|scratch|bandaid)\b', text))
    
    if incident_type in ['Fire', 'Disaster'] or is_high:
        priority = 'High'
    elif is_low:
        priority = 'Low'
    else:
        priority = 'Medium'
        
    # Suggested responder
    if incident_type == 'Medical':
        suggested_responder = 'Dr. Meera Joshi (Medical responder)'
    elif incident_type == 'Fire':
        suggested_responder = 'Campus security & Fire warden'
    elif incident_type == 'Safety':
        suggested_responder = 'Rohan Patil (Campus security)'
    else:
        suggested_responder = 'Aarav Sharma (Warden · Incident lead)'

    # First aid & immediate advice
    if 'dizzy' in text or 'faint' in text:
        first_aid = "Have the student sit or lie down immediately with legs elevated. Loosen tight clothing and ensure fresh airflow. Do not force them to drink until fully alert."
        rationale = "Dizziness poses high fall/syncope hazard. Rapid physical welfare check required."
    elif 'fire' in text or 'smoke' in text:
        first_aid = "Evacuate the area immediately via nearest fire exit. Do not use elevators. Sound the building alarm."
        rationale = "Active fire/smoke threat poses immediate life-safety risk to building occupants."
    elif 'bleed' in text:
        first_aid = "Apply direct firm pressure with clean cloth or sterile gauze. Elevate injured limb if possible."
        rationale = "Hemorrhage must be arrested immediately to prevent hypovolemic shock."
    elif 'ankle' in text or 'sprain' in text:
        first_aid = "Follow R.I.C.E. protocol: Rest limb, apply cold ice pack, compress lightly, elevate above heart level."
        rationale = "Localized musculoskeletal injury; non-life-threatening but requires symptomatic relief."
    elif 'safety' in incident_type.lower() or 'unknown' in text or 'trespass' in text:
        first_aid = "Stay inside locked rooms in well-lit areas. Do not confront unfamiliar individuals."
        rationale = "Campus security incident requiring physical perimeter verification and access control."
    else:
        first_aid = "Keep patient calm and stationary. Confirm exact hostel room/wing and keep phone line open."
        rationale = f"Evaluated based on reported {incident_type.lower()} conditions at {location}."

    title = desc.strip()
    if len(title) > 45:
        title = title[:42] + '…'

    return {
        "priority": priority,
        "suggested_responder": suggested_responder,
        "rationale": rationale,
        "first_aid_guidance": first_aid,
        "suggested_actions": [
            f"Confirm exact location: {location}",
            f"Notify on-duty responder: {suggested_responder}",
            "Maintain live communication until responder is on-scene"
        ],
        "summary_title": title,
        "is_ai": False,
        "engine": "Built-in Triage Rule Engine (Enter API Key for LLM)"
    }

def assess_with_gemini(api_key, model, incident_type, desc, location, people):
    # Prioritize gemini-2.5-flash and available flash models
    models_to_try = [model, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-1.5-flash"]
    # De-duplicate
    seen = set()
    models_to_try = [m for m in models_to_try if m and not (m in seen or seen.add(m))]
    
    system_prompt = (
        "You are HostelAid AI, an emergency response triage intelligence engine for a university hostel.\n"
        "Analyze the provided emergency situation and output STRICT JSON only (no markdown code blocks, no backticks).\n"
        "Required JSON format:\n"
        "{\n"
        '  "priority": "High" | "Medium" | "Low",\n'
        '  "suggested_responder": "Name or Role (e.g. Medical responder, Campus security, Warden)",\n'
        '  "rationale": "Clear medical/safety explanation for the assigned priority (max 2 sentences)",\n'
        '  "first_aid_guidance": "Concise, actionable immediate first-aid instructions for bystanders (max 2-3 sentences)",\n'
        '  "suggested_actions": ["Immediate step 1", "Immediate step 2"],\n'
        '  "summary_title": "Clear concise incident title (under 8 words)"\n'
        "}"
    )

    user_prompt = (
        f"Emergency Type: {incident_type}\n"
        f"Description: {desc}\n"
        f"Location: {location}\n"
        f"People Affected: {people}\n\n"
        "Provide emergency triage JSON assessment:"
    )

    last_error = None
    for m in models_to_try:
        url = GEMINI_API_URL.format(model=m)
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": f"{system_prompt}\n\n{user_prompt}"}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 500
            }
        }
        try:
            resp = requests.post(
                f"{url}?key={api_key}",
                json=payload,
                headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                timeout=12
            )
            if resp.status_code == 200:
                data = resp.json()
                raw_text = data['candidates'][0]['content']['parts'][0]['text']
                # Clean code blocks
                clean = re.sub(r'^```json\s*', '', raw_text.strip(), flags=re.MULTILINE)
                clean = re.sub(r'^```\s*', '', clean, flags=re.MULTILINE)
                clean = clean.strip()
                result = json.loads(clean)
                result['is_ai'] = True
                result['engine'] = f"Google Gemini ({m})"
                return result
            else:
                last_error = f"Gemini error {resp.status_code}: {resp.text}"
        except Exception as e:
            last_error = str(e)
            continue

    raise Exception(last_error or "Failed to call Gemini API")

def assess_with_openai(api_key, model, incident_type, desc, location, people):
    url = "https://api.openai.com/v1/chat/completions"
    system_prompt = (
        "You are HostelAid AI, an emergency response triage engine for a university hostel.\n"
        "Analyze the situation and output STRICT JSON format with keys:\n"
        'priority ("High"|"Medium"|"Low"), suggested_responder, rationale, first_aid_guidance, suggested_actions (list of strings), summary_title.'
    )
    user_prompt = f"Type: {incident_type}\nDesc: {desc}\nLocation: {location}\nPeople: {people}"
    
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model or "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2
        },
        timeout=10
    )
    if resp.status_code == 200:
        content = resp.json()['choices'][0]['message']['content']
        res = json.loads(content)
        res['is_ai'] = True
        res['engine'] = f"OpenAI ({model or 'gpt-4o-mini'})"
        return res
    else:
        raise Exception(f"OpenAI error {resp.status_code}: {resp.text}")

def triage_incident(incident_type, desc, location="Unspecified", people="1 person"):
    """
    Main triage coordinator:
    Attempts real AI call if credentials configured.
    Falls back gracefully to intelligent rules engine if credentials missing or network issue.
    """
    creds = get_active_credentials()
    
    if creds['key']:
        try:
            if creds['provider'] == 'openai':
                return assess_with_openai(creds['key'], creds['model'], incident_type, desc, location, people)
            else:
                return assess_with_gemini(creds['key'], creds['model'], incident_type, desc, location, people)
        except Exception as e:
            # Fall back to smart rules but annotate why
            fallback = rule_based_fallback(incident_type, desc, location, people)
            fallback['ai_notice'] = f"Live AI call attempt: {str(e)[:120]}. Fell back to safety rule heuristic."
            return fallback

    return rule_based_fallback(incident_type, desc, location, people)

def test_api_key(provider, key, model=None):
    """
    Verify if an API key is valid.
    """
    if not key or not key.strip():
        return False, "API key cannot be empty"

    key = key.strip()
    if provider == 'openai':
        try:
            resp = requests.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {key}"},
                timeout=8
            )
            if resp.status_code == 200:
                return True, "OpenAI API key verified successfully!"
            else:
                return False, f"OpenAI rejected key (HTTP {resp.status_code}): {resp.json().get('error', {}).get('message', 'Unauthorized')}"
        except Exception as e:
            return False, f"Network error testing OpenAI: {str(e)}"
    else:
        # Google Gemini
        candidates = [model, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-pro"]
        seen = set()
        candidates = [m for m in candidates if m and not (m in seen or seen.add(m))]
        
        payload = {
            "contents": [{"parts": [{"text": "Hello, respond with 'OK'"}]}],
            "generationConfig": {"maxOutputTokens": 5}
        }
        
        last_msg = ""
        for test_model in candidates:
            url = GEMINI_API_URL.format(model=test_model)
            try:
                resp = requests.post(
                    f"{url}?key={key}",
                    json=payload,
                    headers={"Content-Type": "application/json", "x-goog-api-key": key},
                    timeout=8
                )
                if resp.status_code == 200:
                    return True, f"Google Gemini API key verified successfully! Connected to {test_model}."
                else:
                    try:
                        err_json = resp.json()
                        last_msg = err_json.get('error', {}).get('message', resp.text)
                    except Exception:
                        last_msg = resp.text
            except Exception as e:
                last_msg = str(e)
                
        return False, f"Gemini rejected key: {last_msg}"
