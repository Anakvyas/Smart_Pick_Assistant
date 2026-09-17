SIGNUP_PAYLOAD = {
    "name": "Aarav Sharma",
    "email": "aarav@example.com",
    "password": "Password@123",
    "confirmPassword": "Password@123",
}


def test_successful_signup(client):
    response = client.post("/api/v1/auth/signup", json=SIGNUP_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["message"] == "Picker account created successfully."
    assert body["data"]["user"]["email"] == "aarav@example.com"
    assert body["data"]["user"]["role"] == "PICKER"
    assert "password_hash" not in response.text
    assert "picker_session" in response.cookies


def test_duplicate_email_signup(client):
    client.post("/api/v1/auth/signup", json=SIGNUP_PAYLOAD)
    response = client.post("/api/v1/auth/signup", json=SIGNUP_PAYLOAD)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"


def test_password_mismatch_signup(client):
    payload = {**SIGNUP_PAYLOAD, "confirmPassword": "Different@123"}
    response = client.post("/api/v1/auth/signup", json=payload)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_successful_login(client):
    client.post("/api/v1/auth/signup", json=SIGNUP_PAYLOAD)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "aarav@example.com", "password": "Password@123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["user"]["email"] == "aarav@example.com"
    assert "picker_session" in response.cookies


def test_invalid_login_unknown_email(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "unknown@example.com", "password": "Password@123"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_invalid_login_wrong_password(client):
    client.post("/api/v1/auth/signup", json=SIGNUP_PAYLOAD)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "aarav@example.com", "password": "WrongPassword@123"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_password_hash_never_returned(client):
    signup_response = client.post("/api/v1/auth/signup", json=SIGNUP_PAYLOAD)
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "aarav@example.com", "password": "Password@123"},
    )

    assert "password_hash" not in signup_response.text
    assert "password_hash" not in login_response.text
    assert "password_hash" not in signup_response.json()["data"]["user"]
    assert "password_hash" not in login_response.json()["data"]["user"]
