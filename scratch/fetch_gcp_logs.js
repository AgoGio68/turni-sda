import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));

async function fetchLogs() {
    console.log("Authenticating with Google Cloud Logging API...");
    const auth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/logging.read']
    });
    
    const client = await auth.getClient();
    const projectId = serviceAccount.project_id;
    
    console.log(`Fetching logs for project: ${projectId}...`);
    
    const url = `https://logging.googleapis.com/v2/entries:list`;
    const body = {
        resourceNames: [`projects/${projectId}`],
        filter: `resource.type="cloud_run_revision" AND resource.labels.service_name=~"invia"`,
        orderBy: "timestamp desc",
        pageSize: 40
    };
    
    const response = await client.request({
        url,
        method: 'POST',
        data: body
    });
    
    const entries = response.data.entries || [];
    console.log(`Retrieved ${entries.length} log entries:`);
    
    entries.reverse().forEach(entry => {
        const timestamp = entry.timestamp;
        const service = entry.resource.labels.service_name;
        const textPayload = entry.textPayload || JSON.stringify(entry.jsonPayload);
        const severity = entry.severity || "INFO";
        console.log(`[${timestamp}] [${severity}] [${service}] ${textPayload}`);
    });
}

fetchLogs().catch(console.error);
