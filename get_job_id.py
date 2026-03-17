import json
import sys

def get_job_id():
    try:
        with open('latest_jobs_raw.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        for job in data.get('jobs', []):
            if job['name'] == 'update-prices':
                return job['id']
    except Exception as e:
        print(f"Error: {e}")
    return None

if __name__ == "__main__":
    job_id = get_job_id()
    if job_id:
        print(job_id)
    else:
        sys.exit(1)
