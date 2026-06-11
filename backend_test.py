#!/usr/bin/env python3
"""
ConnectX Backend API Test Suite
Tests: User Search, Contacts, Gift Packet System, Wallet, WebSocket
"""

import requests
import json
import time
import websocket
from typing import Dict, Optional

# Configuration
BASE_URL = "https://expo-troubleshoot-4.preview.emergentagent.com/api"
WS_URL = "wss://webrtc-preview.preview.emergentagent.com/api/ws"

# Test credentials
USER1 = {
    "username": "testuser1",
    "email": "testuser1@example.com",
    "password": "password123",
    "display_name": "Alice"
}

USER2 = {
    "username": "testuser2",
    "email": "testuser2@example.com",
    "password": "password123",
    "display_name": "Bob"
}

# Global state
tokens = {}
user_ids = {}
test_results = []

def log_test(test_name: str, passed: bool, message: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = f"{status} - {test_name}"
    if message:
        result += f": {message}"
    print(result)
    test_results.append({
        "test": test_name,
        "passed": passed,
        "message": message
    })
    return passed

def login_user(user: Dict) -> Optional[Dict]:
    """Login and return token and user_id"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": user["username"], "password": user["password"]},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            return {
                "token": data["access_token"],
                "user_id": data["user"]["id"],
                "user": data["user"]
            }
        else:
            print(f"Login failed for {user['username']}: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"Login error for {user['username']}: {e}")
        return None

def get_headers(user_key: str) -> Dict:
    """Get authorization headers for user"""
    return {"Authorization": f"Bearer {tokens[user_key]}"}

# ============== TEST FUNCTIONS ==============

def test_login():
    """Test user authentication"""
    print("\n=== Testing Authentication ===")
    
    # Login User 1
    result1 = login_user(USER1)
    if result1:
        tokens["user1"] = result1["token"]
        user_ids["user1"] = result1["user_id"]
        log_test("Login User1 (Alice)", True, f"user_id: {result1['user_id']}")
    else:
        log_test("Login User1 (Alice)", False, "Login failed")
        return False
    
    # Login User 2
    result2 = login_user(USER2)
    if result2:
        tokens["user2"] = result2["token"]
        user_ids["user2"] = result2["user_id"]
        log_test("Login User2 (Bob)", True, f"user_id: {result2['user_id']}")
    else:
        log_test("Login User2 (Bob)", False, "Login failed")
        return False
    
    return True

def test_user_search():
    """Test user search API - searches by username, display_name, email, phone"""
    print("\n=== Testing User Search API ===")
    
    headers = get_headers("user1")
    
    # Search by partial username
    response = requests.get(f"{BASE_URL}/users/search?query=test", headers=headers, timeout=10)
    if response.status_code == 200:
        users = response.json()
        found_user2 = any(u["username"] == "testuser2" for u in users)
        log_test("Search by username (query=test)", found_user2, f"Found {len(users)} users")
    else:
        log_test("Search by username (query=test)", False, f"Status: {response.status_code}")
    
    # Search by display name
    response = requests.get(f"{BASE_URL}/users/search?query=Alice", headers=headers, timeout=10)
    if response.status_code == 200:
        users = response.json()
        # Alice is the current user, should not be in results
        found_alice = any(u["display_name"] == "Alice" for u in users)
        log_test("Search by display_name (query=Alice)", not found_alice, "Alice (self) correctly excluded")
    else:
        log_test("Search by display_name (query=Alice)", False, f"Status: {response.status_code}")
    
    # Search by display name - Bob
    response = requests.get(f"{BASE_URL}/users/search?query=Bob", headers=headers, timeout=10)
    if response.status_code == 200:
        users = response.json()
        found_bob = any(u["display_name"] == "Bob" for u in users)
        log_test("Search by display_name (query=Bob)", found_bob, f"Found Bob")
    else:
        log_test("Search by display_name (query=Bob)", False, f"Status: {response.status_code}")
    
    # Search by email
    response = requests.get(f"{BASE_URL}/users/search?query=testuser2", headers=headers, timeout=10)
    if response.status_code == 200:
        users = response.json()
        found = len(users) > 0
        log_test("Search by email pattern", found, f"Found {len(users)} users")
    else:
        log_test("Search by email pattern", False, f"Status: {response.status_code}")

def test_contacts_api():
    """Test contacts API"""
    print("\n=== Testing Contacts API ===")
    
    headers = get_headers("user1")
    
    # Get initial contacts
    response = requests.get(f"{BASE_URL}/contacts", headers=headers, timeout=10)
    if response.status_code == 200:
        contacts = response.json()
        log_test("Get contacts list", True, f"Found {len(contacts)} contacts")
    else:
        log_test("Get contacts list", False, f"Status: {response.status_code}")
        return
    
    # Add User2 as contact
    response = requests.post(
        f"{BASE_URL}/contacts/add",
        json={"user_id": user_ids["user2"]},
        headers=headers,
        timeout=10
    )
    if response.status_code in [200, 201]:
        log_test("Add contact (Bob)", True, "Contact added successfully")
    elif response.status_code == 400 and "already" in response.text.lower():
        log_test("Add contact (Bob)", True, "Contact already exists (expected)")
    else:
        log_test("Add contact (Bob)", False, f"Status: {response.status_code} - {response.text}")

def test_wallet_initial():
    """Test wallet API - get initial balance"""
    print("\n=== Testing Wallet API (Initial) ===")
    
    # Get User1 wallet
    headers1 = get_headers("user1")
    response = requests.get(f"{BASE_URL}/wallet", headers=headers1, timeout=10)
    if response.status_code == 200:
        wallet = response.json()
        balance1 = wallet.get("balance", 0)
        log_test("Get User1 (Alice) wallet", True, f"Balance: ${balance1:.2f}")
        return {"user1": balance1}
    else:
        log_test("Get User1 (Alice) wallet", False, f"Status: {response.status_code}")
        return None

def test_gift_send_direct():
    """Test sending a direct gift packet"""
    print("\n=== Testing Gift Packet - Send Direct ===")
    
    headers = get_headers("user1")
    
    # Send gift from Alice to Bob
    gift_data = {
        "chat_id": user_ids["user2"],
        "total_amount": 2.0,
        "gift_type": "direct",
        "message": "Test gift from Alice to Bob"
    }
    
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json=gift_data,
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        packet = response.json()
        packet_id = packet.get("id")
        log_test("Send direct gift ($2.00)", True, f"packet_id: {packet_id}")
        return packet_id
    else:
        log_test("Send direct gift ($2.00)", False, f"Status: {response.status_code} - {response.text}")
        return None

def test_gift_get_details(packet_id: str):
    """Test getting gift packet details"""
    print("\n=== Testing Gift Packet - Get Details ===")
    
    headers = get_headers("user2")
    
    response = requests.get(
        f"{BASE_URL}/gifts/{packet_id}",
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        data = response.json()
        packet = data.get("packet", {})
        log_test("Get gift details", True, f"Status: {packet.get('status')}, Amount: ${packet.get('total_amount')}")
        return True
    else:
        log_test("Get gift details", False, f"Status: {response.status_code}")
        return False

def test_gift_claim(packet_id: str):
    """Test claiming a gift packet"""
    print("\n=== Testing Gift Packet - Claim ===")
    
    headers = get_headers("user2")
    
    response = requests.post(
        f"{BASE_URL}/gifts/{packet_id}/claim",
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        result = response.json()
        success = result.get("success", False)
        amount = result.get("amount", 0)
        message = result.get("message", "")
        log_test("Claim gift (Bob)", success, f"Amount: ${amount:.2f}, Message: {message}")
        return success
    else:
        log_test("Claim gift (Bob)", False, f"Status: {response.status_code} - {response.text}")
        return False

def test_gift_double_claim(packet_id: str):
    """Test double claim prevention"""
    print("\n=== Testing Gift Packet - Double Claim Prevention ===")
    
    headers = get_headers("user2")
    
    response = requests.post(
        f"{BASE_URL}/gifts/{packet_id}/claim",
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        result = response.json()
        success = result.get("success", False)
        message = result.get("message", "")
        # Should fail with "already claimed" message
        expected = not success and "already claimed" in message.lower()
        log_test("Double claim prevention", expected, f"Message: {message}")
        return expected
    else:
        log_test("Double claim prevention", False, f"Status: {response.status_code}")
        return False

def test_gift_sender_cannot_claim():
    """Test that sender cannot claim their own gift"""
    print("\n=== Testing Gift Packet - Sender Cannot Claim ===")
    
    headers = get_headers("user1")
    
    # Alice sends a gift to Bob
    gift_data = {
        "chat_id": user_ids["user2"],
        "total_amount": 1.0,
        "gift_type": "direct",
        "message": "Test sender claim"
    }
    
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json=gift_data,
        headers=headers,
        timeout=10
    )
    
    if response.status_code != 200:
        log_test("Sender cannot claim (setup)", False, "Failed to send gift")
        return False
    
    packet_id = response.json().get("id")
    
    # Alice tries to claim her own gift
    response = requests.post(
        f"{BASE_URL}/gifts/{packet_id}/claim",
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        result = response.json()
        success = result.get("success", False)
        message = result.get("message", "")
        # Should fail with "cannot claim your own gift"
        expected = not success and "own gift" in message.lower()
        log_test("Sender cannot claim own gift", expected, f"Message: {message}")
        return expected
    else:
        log_test("Sender cannot claim own gift", False, f"Status: {response.status_code}")
        return False

def test_gift_insufficient_balance():
    """Test insufficient balance error"""
    print("\n=== Testing Gift Packet - Insufficient Balance ===")
    
    headers = get_headers("user1")
    
    # Try to send a gift with huge amount
    gift_data = {
        "chat_id": user_ids["user2"],
        "total_amount": 999999.0,
        "gift_type": "direct",
        "message": "Test insufficient balance"
    }
    
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json=gift_data,
        headers=headers,
        timeout=10
    )
    
    # Should return 400 with "Insufficient balance"
    expected = response.status_code == 400 and "insufficient" in response.text.lower()
    log_test("Insufficient balance error", expected, f"Status: {response.status_code}")
    return expected

def test_gift_validation():
    """Test gift validation (amount=0, negative, invalid type)"""
    print("\n=== Testing Gift Packet - Validation ===")
    
    headers = get_headers("user1")
    
    # Test amount = 0
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json={"chat_id": user_ids["user2"], "total_amount": 0, "gift_type": "direct"},
        headers=headers,
        timeout=10
    )
    expected1 = response.status_code == 400
    log_test("Validation: amount=0", expected1, f"Status: {response.status_code}")
    
    # Test negative amount
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json={"chat_id": user_ids["user2"], "total_amount": -5, "gift_type": "direct"},
        headers=headers,
        timeout=10
    )
    expected2 = response.status_code == 400
    log_test("Validation: amount=-5", expected2, f"Status: {response.status_code}")
    
    # Test invalid gift_type
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json={"chat_id": user_ids["user2"], "total_amount": 5, "gift_type": "invalid_type"},
        headers=headers,
        timeout=10
    )
    expected3 = response.status_code == 400
    log_test("Validation: invalid gift_type", expected3, f"Status: {response.status_code}")
    
    return expected1 and expected2 and expected3

def test_gift_equal_split():
    """Test equal split gift"""
    print("\n=== Testing Gift Packet - Equal Split ===")
    
    headers1 = get_headers("user1")
    headers2 = get_headers("user2")
    
    # Alice sends equal split gift
    gift_data = {
        "chat_id": user_ids["user2"],
        "total_amount": 10.0,
        "gift_type": "equal",
        "total_slots": 2,
        "message": "Split gift test",
        "is_group": False
    }
    
    response = requests.post(
        f"{BASE_URL}/gifts/send",
        json=gift_data,
        headers=headers1,
        timeout=10
    )
    
    if response.status_code != 200:
        log_test("Equal split gift - send", False, f"Status: {response.status_code}")
        return False
    
    packet = response.json()
    packet_id = packet.get("id")
    log_test("Equal split gift - send ($10, 2 slots)", True, f"packet_id: {packet_id}")
    
    # Bob claims
    response = requests.post(
        f"{BASE_URL}/gifts/{packet_id}/claim",
        headers=headers2,
        timeout=10
    )
    
    if response.status_code == 200:
        result = response.json()
        success = result.get("success", False)
        amount = result.get("amount", 0)
        # Should receive $5 (10/2)
        expected = success and amount == 5.0
        log_test("Equal split - Bob claims", expected, f"Amount: ${amount:.2f} (expected $5.00)")
        
        # Verify packet status
        response = requests.get(f"{BASE_URL}/gifts/{packet_id}", headers=headers2, timeout=10)
        if response.status_code == 200:
            data = response.json()
            packet = data.get("packet", {})
            remaining = packet.get("remaining_amount", 0)
            claimed_slots = packet.get("claimed_slots", 0)
            log_test("Equal split - verify packet", True, f"Remaining: ${remaining:.2f}, Claimed slots: {claimed_slots}/2")
        
        return expected
    else:
        log_test("Equal split - Bob claims", False, f"Status: {response.status_code}")
        return False

def test_wallet_transactions():
    """Test wallet transactions after gifts"""
    print("\n=== Testing Wallet Transactions ===")
    
    # Get User1 transactions
    headers1 = get_headers("user1")
    response = requests.get(f"{BASE_URL}/wallet/transactions", headers=headers1, timeout=10)
    if response.status_code == 200:
        transactions = response.json()
        gift_txs = [tx for tx in transactions if tx.get("tx_type") in ["gift_sent", "gift_received"]]
        log_test("User1 (Alice) transactions", True, f"Total: {len(transactions)}, Gift-related: {len(gift_txs)}")
    else:
        log_test("User1 (Alice) transactions", False, f"Status: {response.status_code}")
    
    # Get User2 transactions
    headers2 = get_headers("user2")
    response = requests.get(f"{BASE_URL}/wallet/transactions", headers=headers2, timeout=10)
    if response.status_code == 200:
        transactions = response.json()
        gift_txs = [tx for tx in transactions if tx.get("tx_type") in ["gift_sent", "gift_received"]]
        log_test("User2 (Bob) transactions", True, f"Total: {len(transactions)}, Gift-related: {len(gift_txs)}")
    else:
        log_test("User2 (Bob) transactions", False, f"Status: {response.status_code}")

def test_wallet_balance_verification():
    """Verify wallet balances are consistent"""
    print("\n=== Testing Wallet Balance Verification ===")
    
    # Get User1 balance
    headers1 = get_headers("user1")
    response = requests.get(f"{BASE_URL}/wallet", headers=headers1, timeout=10)
    if response.status_code == 200:
        wallet = response.json()
        balance1 = wallet.get("balance", 0)
        log_test("User1 (Alice) final balance", True, f"Balance: ${balance1:.2f}")
    else:
        log_test("User1 (Alice) final balance", False, f"Status: {response.status_code}")
    
    # Get User2 balance
    headers2 = get_headers("user2")
    response = requests.get(f"{BASE_URL}/wallet", headers=headers2, timeout=10)
    if response.status_code == 200:
        wallet = response.json()
        balance2 = wallet.get("balance", 0)
        log_test("User2 (Bob) final balance", True, f"Balance: ${balance2:.2f}")
    else:
        log_test("User2 (Bob) final balance", False, f"Status: {response.status_code}")

def test_websocket_connection():
    """Test WebSocket connection (quick sanity check)"""
    print("\n=== Testing WebSocket Connection ===")
    
    try:
        ws_url = f"{WS_URL}/{user_ids['user1']}?token={tokens['user1']}"
        ws = websocket.create_connection(ws_url, timeout=5)
        log_test("WebSocket connection", True, "Connected successfully")
        ws.close()
        return True
    except Exception as e:
        log_test("WebSocket connection", False, f"Error: {str(e)}")
        return False

# ============== MAIN TEST RUNNER ==============

def run_all_tests():
    """Run all backend tests"""
    print("=" * 60)
    print("ConnectX Backend API Test Suite")
    print("=" * 60)
    
    # Login first
    if not test_login():
        print("\n❌ Login failed - cannot continue tests")
        return
    
    # User Search API
    test_user_search()
    
    # Contacts API
    test_contacts_api()
    
    # Wallet initial state
    test_wallet_initial()
    
    # Gift Packet System - comprehensive tests
    packet_id = test_gift_send_direct()
    if packet_id:
        test_gift_get_details(packet_id)
        test_gift_claim(packet_id)
        test_gift_double_claim(packet_id)
    
    test_gift_sender_cannot_claim()
    test_gift_insufficient_balance()
    test_gift_validation()
    test_gift_equal_split()
    
    # Wallet verification
    test_wallet_transactions()
    test_wallet_balance_verification()
    
    # WebSocket
    test_websocket_connection()
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for r in test_results if r["passed"])
    total = len(test_results)
    percentage = (passed / total * 100) if total > 0 else 0
    
    print(f"Total Tests: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {total - passed}")
    print(f"Success Rate: {percentage:.1f}%")
    
    # Show failed tests
    failed_tests = [r for r in test_results if not r["passed"]]
    if failed_tests:
        print("\n❌ Failed Tests:")
        for test in failed_tests:
            print(f"  - {test['test']}: {test['message']}")
    else:
        print("\n✅ All tests passed!")

if __name__ == "__main__":
    run_all_tests()
