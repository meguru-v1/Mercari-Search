import json
import requests
import sys
import os

def get_job_id():
    try:
        with open('latest_jobs_raw.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        for job in data.get('jobs', []):
            if job['name'] == 'update-prices':
                return job['id']
    except Exception as e:
        print(f"Error reading jobs JSON: {e}")
    return None

def download_logs(job_id):
    headers = {
        "Accept": "application/vnd.github.v3+json",
        # Use a placeholder if token is not available, but usually logs are public for public repos
        # Actually we should try without token first if it is public
    }
    url = f"https://api.github.com/repos/GAKU27/Mercari-Search/actions/jobs/{job_id}/logs"
    print(f"Downloading logs from: {url}")
    
    try:
        # allow_redirects is True by default
        response = requests.get(url, headers=headers, stream=True)
        response.raise_for_status()
        
        with open('scraper_full_log.txt', 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print("Download successful.")
    except Exception as e:
        print(f"Error downloading logs: {e}")

if __name__ == "__main__":
    jid = get_job_id()
    if jid:
        download_logs(jid)
    else:
        print("Job ID not found.")
        sys.exit(1)
