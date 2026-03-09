#!/bin/bash
# ============================================================
# Town Meeting Manager — Auth Flow Test Script
# ============================================================
# Tests the complete Supabase Auth flow with custom JWT claims:
#   1. Sign up a test admin user (onboarding scenario)
#   2. Log in and get JWT
#   3. Verify JWT contains custom claims (town_id, role, person_id, user_account_id)
#   4. Verify RLS works with JWT claims (query town table)
#   5. Verify person and user_account records were created by handle_new_user()
#
# Prerequisites:
#   - Docker stack running (docker compose up -d)
#   - All migrations applied (000001-000040)
#   - Seed data loaded (supabase/seed.sql)
#
# Usage:
#   chmod +x supabase/tests/test_auth.sh
#   ./supabase/tests/test_auth.sh
# ============================================================

set -e

SUPABASE_URL="http://localhost:54321"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q"

PASS=0
FAIL=0

pass() { echo "  ✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "============================================================"
echo "Auth Flow Test — Town Meeting Manager"
echo "============================================================"

# ─── Step 1: Verify seed data exists ──────────────────────────
echo ""
echo "--- Step 1: Verify seed data exists ---"
TOWN_ID=$(docker exec town-meeting-db psql -U postgres -t -c "SELECT id FROM town LIMIT 1;" | tr -d '[:space:]')

if [ -n "$TOWN_ID" ]; then
  pass "Seed town found: $TOWN_ID"
else
  fail "No seed town found"
  echo "Run: docker exec -i town-meeting-db psql -U postgres -d postgres < supabase/seed.sql"
  exit 1
fi

# ─── Step 2: Clean up any previous test user ──────────────────
echo ""
echo "--- Step 2: Clean up previous test data ---"
docker exec town-meeting-db psql -U postgres -d postgres -c "
  DELETE FROM user_account WHERE id IN (
    SELECT ua.id FROM user_account ua JOIN person p ON ua.person_id = p.id
    WHERE p.email = 'testadmin@test.local'
  );
  DELETE FROM person WHERE email = 'testadmin@test.local';
  DELETE FROM auth.users WHERE email = 'testadmin@test.local';
" > /dev/null 2>&1
pass "Cleaned up previous test data"

# ─── Step 3: Sign up a test admin user ────────────────────────
echo ""
echo "--- Step 3: Sign up test admin (onboarding scenario) ---"
SIGNUP_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/signup" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"testadmin@test.local\",
    \"password\": \"TestPassword123!\",
    \"data\": {
      \"town_id\": \"${TOWN_ID}\",
      \"name\": \"Test Admin User\"
    }
  }")

SIGNUP_ID=$(echo "$SIGNUP_RESPONSE" | python3 -c "
import sys,json
data = json.load(sys.stdin)
# With ENABLE_EMAIL_AUTOCONFIRM, signup returns a session with user nested
uid = data.get('id', '') or data.get('user', {}).get('id', '')
print(uid)
" 2>/dev/null || echo "")

if [ -n "$SIGNUP_ID" ] && [ "$SIGNUP_ID" != "" ]; then
  pass "Signup succeeded, auth user ID: $SIGNUP_ID"
else
  fail "Signup failed"
  echo "  Response: $SIGNUP_RESPONSE"
fi

# Give the trigger a moment to execute
sleep 1

# ─── Step 4: Verify handle_new_user created records ───────────
echo ""
echo "--- Step 4: Verify handle_new_user() created person + user_account ---"
PERSON_CHECK=$(docker exec town-meeting-db psql -U postgres -t -c "
  SELECT p.name, ua.role, ua.town_id
  FROM person p
  JOIN user_account ua ON ua.person_id = p.id
  WHERE p.email = 'testadmin@test.local';
")

if echo "$PERSON_CHECK" | grep -q "admin"; then
  pass "handle_new_user() created person and admin user_account"
else
  fail "handle_new_user() did not create expected records"
  echo "  Result: $PERSON_CHECK"
fi

# ─── Step 5: Log in and get JWT ───────────────────────────────
echo ""
echo "--- Step 5: Log in and get JWT ---"
LOGIN_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"testadmin@test.local\",
    \"password\": \"TestPassword123!\"
  }")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")

if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "" ]; then
  pass "Login succeeded, got access token"
else
  fail "Login failed"
  echo "  Response: $LOGIN_RESPONSE"
fi

# ─── Step 6: Decode and verify JWT claims ─────────────────────
echo ""
echo "--- Step 6: Verify JWT contains custom claims ---"

if [ -n "$ACCESS_TOKEN" ]; then
  # Decode JWT payload (add padding as needed)
  JWT_PAYLOAD=$(echo "$ACCESS_TOKEN" | cut -d'.' -f2 | python3 -c "
import sys, base64, json
payload = sys.stdin.read().strip()
# Add padding
padding = 4 - len(payload) % 4
if padding != 4:
    payload += '=' * padding
decoded = base64.urlsafe_b64decode(payload)
data = json.loads(decoded)
print(json.dumps(data.get('app_metadata', {})))
" 2>/dev/null)

  echo "  JWT app_metadata: $JWT_PAYLOAD"

  # Check individual claims
  CLAIM_TOWN_ID=$(echo "$JWT_PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('town_id',''))" 2>/dev/null)
  CLAIM_ROLE=$(echo "$JWT_PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('role',''))" 2>/dev/null)
  CLAIM_PERSON_ID=$(echo "$JWT_PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('person_id',''))" 2>/dev/null)
  CLAIM_UA_ID=$(echo "$JWT_PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_account_id',''))" 2>/dev/null)

  if [ "$CLAIM_TOWN_ID" = "$TOWN_ID" ]; then
    pass "JWT town_id matches seed town: $CLAIM_TOWN_ID"
  else
    fail "JWT town_id mismatch: expected $TOWN_ID, got $CLAIM_TOWN_ID"
  fi

  if [ "$CLAIM_ROLE" = "admin" ]; then
    pass "JWT role is 'admin'"
  else
    fail "JWT role mismatch: expected 'admin', got '$CLAIM_ROLE'"
  fi

  if [ -n "$CLAIM_PERSON_ID" ] && [ "$CLAIM_PERSON_ID" != "" ]; then
    pass "JWT person_id is present: $CLAIM_PERSON_ID"
  else
    fail "JWT person_id is missing"
  fi

  if [ -n "$CLAIM_UA_ID" ] && [ "$CLAIM_UA_ID" != "" ]; then
    pass "JWT user_account_id is present: $CLAIM_UA_ID"
  else
    fail "JWT user_account_id is missing"
  fi
fi

# ─── Step 7: Test RLS — query town table with JWT ────────────
echo ""
echo "--- Step 7: Test RLS — read own town with JWT ---"
if [ -n "$ACCESS_TOKEN" ]; then
  TOWN_RESPONSE=$(curl -s "${SUPABASE_URL}/rest/v1/town?select=id,name" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")

  TOWN_NAME=$(echo "$TOWN_RESPONSE" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if isinstance(data, list) and len(data) > 0:
    print(data[0].get('name',''))
else:
    print('')
" 2>/dev/null)

  if [ -n "$TOWN_NAME" ]; then
    pass "RLS query returned town: $TOWN_NAME"
  else
    fail "RLS query returned no town"
    echo "  Response: $TOWN_RESPONSE"
  fi
fi

# ─── Step 8: Verify auth.users has app_metadata ──────────────
echo ""
echo "--- Step 8: Verify auth.users has app_metadata set ---"
AUTH_META=$(docker exec town-meeting-db psql -U postgres -t -c "
  SELECT raw_app_meta_data FROM auth.users WHERE email = 'testadmin@test.local';
")

if echo "$AUTH_META" | grep -q "town_id"; then
  pass "auth.users.raw_app_meta_data contains town_id"
else
  fail "auth.users.raw_app_meta_data missing town_id"
  echo "  Metadata: $AUTH_META"
fi

# ─── Step 9: Verify Inbucket is accessible ───────────────────
echo ""
echo "--- Step 9: Verify Inbucket dev email server ---"
INBUCKET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:9000/")

if [ "$INBUCKET_STATUS" = "200" ]; then
  pass "Inbucket web UI accessible at http://localhost:9000"
else
  fail "Inbucket not accessible (HTTP $INBUCKET_STATUS)"
fi

# ─── Cleanup ─────────────────────────────────────────────────
echo ""
echo "--- Cleanup: Remove test data ---"
docker exec town-meeting-db psql -U postgres -d postgres -c "
  DELETE FROM user_account WHERE id IN (
    SELECT ua.id FROM user_account ua JOIN person p ON ua.person_id = p.id
    WHERE p.email = 'testadmin@test.local'
  );
  DELETE FROM person WHERE email = 'testadmin@test.local';
  DELETE FROM auth.users WHERE email = 'testadmin@test.local';
" > /dev/null 2>&1
pass "Test data cleaned up"

# ─── Results ──────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
  echo "All auth flow tests passed!"
else
  echo "Some tests failed — review output above."
  exit 1
fi
echo "============================================================"
