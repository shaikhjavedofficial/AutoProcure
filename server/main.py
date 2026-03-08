import asyncio
import json
import uuid
import os
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
TINYFISH_API_KEY = os.getenv("TINYFISH_API_KEY")

app = FastAPI(title="Enterprise B2B Agent with HITL")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- IN-MEMORY STATE MANAGEMENT ---
job_queues = {}

active_agent_sessions = {} 

class AgentRequest(BaseModel):
    url: str
    goal: str

class AgentInput(BaseModel):
    user_input: str # This is where the 6-digit OTP will go

# --- THE BACKGROUND WORKER ---
async def execute_tinyfish_task(job_id: str, url: str, goal: str):
    queue = job_queues.get(job_id)
    if not queue:
        return

    await queue.put(json.dumps({"type": "SYSTEM", "message": "Worker booted. Navigating to target..."}))

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                "https://agent.tinyfish.ai/v1/automation/run-sse",
                headers={
                    "X-API-Key": TINYFISH_API_KEY, 
                    "Content-Type": "application/json"
                },
                json={"url": url, "goal": goal}
            ) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if line and line.startswith("data: "):
                        event_data = line[6:]
                        event_json = json.loads(event_data)
                        
                        # Capture the remote session ID so we can talk back to it later
                        if "sessionId" in event_json:
                            active_agent_sessions[job_id] = event_json["sessionId"]

                        # Check if the bot is begging for help
                        if event_json.get("type") == "ACTION_REQUIRED" or event_json.get("status") == "PAUSED":
                            await queue.put(json.dumps({
                                "type": "HITL_REQUIRED", 
                                "message": "Amazon requested an OTP. Waiting for user input..."
                            }))
                            # We don't break the loop here. We stay connected and wait.
                        else:
                            await queue.put(event_data)

                        if event_json.get("type") == "COMPLETE" or event_json.get("type") == "FATAL_ERROR":
                            break

    except Exception as e:
        await queue.put(json.dumps({"type": "FATAL_ERROR", "message": str(e)}))

# --- ENDPOINTS ---

@app.post("/api/run-agent")
async def dispatch_agent(request: AgentRequest):
    job_id = str(uuid.uuid4())
    job_queues[job_id] = asyncio.Queue()
    asyncio.create_task(execute_tinyfish_task(job_id, request.url, request.goal))
    return {"job_id": job_id, "status": "queued"}

# *** NEW HITL ENDPOINT ***
@app.post("/api/agent/{job_id}/input")
async def provide_agent_input(job_id: str, payload: AgentInput):
    """
    Your React UI will call this when the user types the OTP and hits submit.
    """
    if job_id not in active_agent_sessions:
        raise HTTPException(status_code=404, detail="Active session not found for this job.")

    session_id = active_agent_sessions[job_id]
    queue = job_queues.get(job_id)

    # 1. Tell the UI we received the OTP
    if queue:
        await queue.put(json.dumps({"type": "SYSTEM", "message": f"OTP received. Injecting into cloud browser..."}))

    # 2. Forward the OTP to the TinyFish cloud browser
    try:
        async with httpx.AsyncClient() as client:
            # Note: Verify this exact URL structure in the TinyFish documentation
            response = await client.post(
                f"https://agent.tinyfish.ai/v1/sessions/{session_id}/input", 
                headers={
                    "X-API-Key": TINYFISH_API_KEY,
                    "Content-Type": "application/json"
                },
                json={"text": payload.user_input}
            )
            response.raise_for_status()
            
            if queue:
                await queue.put(json.dumps({"type": "SYSTEM", "message": "Input accepted. Resuming automation..."}))
                
            return {"status": "success", "message": "Input injected into session."}
            
    except Exception as e:
        if queue:
            await queue.put(json.dumps({"type": "ERROR", "message": f"Failed to inject input: {str(e)}"}))
        raise HTTPException(status_code=500, detail="Failed to communicate with remote agent.")


@app.websocket("/ws/agent/{job_id}")
async def agent_websocket(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in job_queues:
        await websocket.close(code=1008)
        return
    queue = job_queues[job_id]
    
    try:
        while True:
            event_data = await queue.get()
            await websocket.send_text(event_data)
            if '"type": "COMPLETE"' in event_data or '"type": "FATAL_ERROR"' in event_data:
                break
    except WebSocketDisconnect:
        pass
    finally:
        if job_id in job_queues:
            del job_queues[job_id]
        if job_id in active_agent_sessions:
            del active_agent_sessions[job_id]
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)