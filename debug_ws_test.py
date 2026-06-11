#!/usr/bin/env python3
"""
Debug WebSocket Chat Test
"""

import asyncio
import json
import websockets
import requests

# Test Configuration
WS_BASE = "wss://webrtc-preview.preview.emergentagent.com/api/ws"
API_BASE = "https://expo-troubleshoot-4.preview.emergentagent.com/api"

async def debug_websocket_chat():
    """Debug WebSocket chat functionality"""
    print("=== Debug WebSocket Chat Test ===")
    
    # Login users
    print("Logging in users...")
    response1 = requests.post(f"{API_BASE}/auth/login", 
                             json={"username": "testuser1", "password": "password123"})
    response2 = requests.post(f"{API_BASE}/auth/login",
                             json={"username": "testuser2", "password": "password123"})
    
    if response1.status_code != 200 or response2.status_code != 200:
        print("❌ Login failed")
        return
    
    user1_data = response1.json()
    user2_data = response2.json()
    
    user1_id = user1_data['user']['id']
    user2_id = user2_data['user']['id']
    user1_token = user1_data['access_token']
    user2_token = user2_data['access_token']
    
    print(f"✅ Users logged in: {user1_id}, {user2_id}")
    
    try:
        # Connect WebSockets
        ws_url1 = f"{WS_BASE}/{user1_id}?token={user1_token}"
        ws_url2 = f"{WS_BASE}/{user2_id}?token={user2_token}"
        
        print("Connecting WebSockets...")
        user1_ws = await websockets.connect(ws_url1)
        user2_ws = await websockets.connect(ws_url2)
        print("✅ Both WebSockets connected")
        
        # Create message listener for user2
        async def listen_user2():
            try:
                while True:
                    message = await user2_ws.recv()
                    data = json.loads(message)
                    print(f"📨 User2 received: {data['type']}")
                    if data.get('type') == 'new_message':
                        print(f"   Content: {data['data']['content']}")
                        return data
            except Exception as e:
                print(f"❌ User2 listener error: {e}")
                return None
        
        # Create message listener for user1
        async def listen_user1():
            try:
                while True:
                    message = await user1_ws.recv()
                    data = json.loads(message)
                    print(f"📨 User1 received: {data['type']}")
                    if data.get('type') == 'message_sent':
                        print(f"   Message ID: {data['data']['id']}")
                        return data
            except Exception as e:
                print(f"❌ User1 listener error: {e}")
                return None
        
        # Start listeners
        user1_task = asyncio.create_task(listen_user1())
        user2_task = asyncio.create_task(listen_user2())
        
        # Send message from user1 to user2
        message = {
            "type": "message",
            "data": {
                "receiver_id": user2_id,
                "content": "Debug test message",
                "message_type": "text"
            }
        }
        
        print("📤 Sending message from user1 to user2...")
        await user1_ws.send(json.dumps(message))
        
        # Wait for responses
        done, pending = await asyncio.wait([user1_task, user2_task], timeout=15.0, return_when=asyncio.ALL_COMPLETED)
        
        # Cancel pending tasks
        for task in pending:
            task.cancel()
        
        # Check results
        user1_result = None
        user2_result = None
        
        for task in done:
            try:
                result = task.result()
                if result and result.get('type') == 'message_sent':
                    user1_result = result
                elif result and result.get('type') == 'new_message':
                    user2_result = result
            except Exception as e:
                print(f"❌ Task result error: {e}")
        
        # Summary
        if user1_result:
            print("✅ User1 received message_sent confirmation")
        else:
            print("❌ User1 did not receive message_sent confirmation")
            
        if user2_result:
            print("✅ User2 received new_message")
        else:
            print("❌ User2 did not receive new_message")
        
        # Check if message was saved to database
        print("\n📊 Checking database...")
        messages_response = requests.get(f"{API_BASE}/messages/{user2_id}", 
                                       headers={"Authorization": f"Bearer {user1_token}"})
        if messages_response.status_code == 200:
            messages = messages_response.json()
            recent_messages = [m for m in messages if m['content'] == 'Debug test message']
            if recent_messages:
                print("✅ Message saved to database")
            else:
                print("❌ Message not found in database")
        else:
            print(f"❌ Failed to check messages: {messages_response.status_code}")
        
        await user1_ws.close()
        await user2_ws.close()
        
    except Exception as e:
        print(f"❌ Test failed: {e}")

if __name__ == "__main__":
    asyncio.run(debug_websocket_chat())