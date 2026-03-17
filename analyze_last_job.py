import json
import os

def analyze():
    path = 'latest_job_raw.json'
    if not os.path.exists(path):
        print("Job file not found.")
        return
    
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    for job in data.get('jobs', []):
        print(f"Job: {job['name']} ({job['status']} - {job['conclusion']})")
        for step in job.get('steps', []):
            print(f"  - {step['name']}: {step['status']} ({step['conclusion']})")

if __name__ == "__main__":
    analyze()
