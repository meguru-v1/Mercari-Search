import json
import sys

def analyze():
    try:
        with open('latest_runs_raw.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        runs = data.get('workflow_runs', [])
        print(f"Total runs found: {len(runs)}")
        
        for run in runs[:5]:
            print(f"--- Run {run['id']} ---")
            print(f"Name: {run['name']}")
            print(f"Event: {run['event']}")
            print(f"Status: {run['status']}")
            print(f"Conclusion: {run['conclusion']}")
            print(f"Created at: {run['created_at']}")
            print(f"Title: {run['display_title']}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    analyze()
