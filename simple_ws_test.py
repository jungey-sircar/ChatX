#!/usr/bin/env python3
"""
Simple WebSocket Chat Test
"""

import asyncio
import json
import websockets

# Test Configuration
WS_BASE = "wss://webrtc-preview.preview.emergentagent.com/api/ws"

# Test tokens (from previous test)
USER1_ID = "3714b3d1-06ed-483b-8fc9-b929c5288675"
USER2_ID = "e2228273-fb02-494e-b991-264908404fd1"

async def test_chat_message():
    """Test simple chat message"""
    print("Testing WebSocket Chat Message...")
    
    # Get fresh tokens
    import requests
    
    # Login user1
    response1 = requests.post("https://expo-troubleshoot-4.preview.emergentagent.com/api/auth/login", 
                             json={"username": "testuser1", "password": "password123"})
    if response1.status_code != 200:
        print(f"❌ User1 login failed: {response1.status_code}")
        return
    
    user1_token = response1.json()['access_token']
    
    # Login user2  
    response2 = requests.post("https://expo-troubleshoot-4.preview.emergentagent.com/api/auth/login",
                             json={"username": "testuser2", "password": "password123"})
    if response2.status_code != 200:
        print(f"❌ User2 login failed: {response2.status_code}")
        return
        
    user2_token = response2.json()['access_token']
    
    try:
        # Connect user1
        ws_url1 = f"{WS_BASE}/{USER1_ID}?token={user1_token}"
        user1_ws = await websockets.connect(ws_url1)
        print("✅ User1 WebSocket connected")
        
        # Connect user2
        ws_url2 = f"{WS_BASE}/{USER2_ID}?token={user2_token}"
        user2_ws = await websockets.connect(ws_url2)
        print("✅ User2 WebSocket connected")
        
        # User1 sends message to user2
        message = {
            "type": "message",
            "data": {
                "receiver_id": USER2_ID,
                "content": "Hello from user1!",
                "message_type": "text"
            }
        }
        
        await user1_ws.send(json.dumps(message))
        print("✅ Message sent from user1")
        
        # Listen for responses on both connections
        tasks = [
            asyncio.create_task(user1_ws.recv()),
            asyncio.create_task(user2_ws.recv())
        ]
        
        done, pending = await asyncio.wait(tasks, timeout=10.0, return_when=asyncio.FIRST_COMPLETED)
        
        # Cancel pending tasks
        for task in pending:
            task.cancel()
        
        if done:
            for task in done:
                try:
                    response = task.result()
                    data = json.loads(response)
                    print(f"✅ Received response: {data['type']}")
                    if data.get('type') == 'message_sent':
                        print("✅ Chat message working correctly")
                    elif data.get('type') == 'new_message':
                        print("✅ Message delivered to receiver")
                except Exception as e:
                    print(f"❌ Error parsing response: {e}")
        else:
            print("❌ No response received within timeout")
        
        await user1_ws.close()
        await user2_ws.close()
        
    except Exception as e:
        print(f"❌ WebSocket test failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_chat_message())