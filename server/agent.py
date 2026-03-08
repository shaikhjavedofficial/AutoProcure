import json
import os
import requests
from dotenv import load_dotenv

# Load the API key from your .env file
load_dotenv()
TINYFISH_API_KEY = os.getenv("TINYFISH_API_KEY")

def stream_tinyfish_agent(url: str, goal: str):
    """
    Takes any URL and any goal, sends it to TinyFish, 
    and streams the live events back to main.py.
    """
    response = requests.post(
        "https://agent.tinyfish.ai/v1/automation/run-sse",
        headers={
            "X-API-Key": TINYFISH_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "url": url,       # Dynamically injected from main.py
            "goal": goal,     # Dynamically injected from main.py
        },
        stream=True,
    )

    # Read the stream line-by-line as it comes in from TinyFish
    for line in response.iter_lines():
        if line:
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                event = json.loads(line_str[6:])
                yield event  # Pass the event up to FastAPI