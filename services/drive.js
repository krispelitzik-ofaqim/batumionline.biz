const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let drive;

function getAuthClient() {
  if (drive) return drive;

  let credentials;

  // Option 1: credentials JSON string in env var (for Render / cloud deployments)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  } else {
    // Option 2: credentials file path (for local development)
    const credentialsPath = process.env.GOOGLE_DRIVE_CREDENTIALS || './google-credentials.json';
    if (!fs.existsSync(credentialsPath)) {
      console.warn('Google Drive credentials not found. Drive integration disabled.');
      return null;
    }
    credentials = JSON.parse(fs.readFileSync(credentialsPath));
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  drive = google.drive({ version: 'v3', auth });
  return drive;
}

async function uploadFile(filePath, fileName, mimeType, folderId) {
  const driveClient = getAuthClient();
  if (!driveClient) return { success: false, error: 'Drive not configured' };

  try {
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };

    const media = {
      mimeType,
      body: fs.createReadStream(filePath)
    };

    const response = await driveClient.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, name, webViewLink'
    });

    // Set file permission to anyone with link can view
    await driveClient.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    return {
      success: true,
      fileId: response.data.id,
      fileName: response.data.name,
      webViewLink: response.data.webViewLink
    };
  } catch (error) {
    console.error('Drive upload error:', error.message);
    return { success: false, error: error.message };
  }
}

async function createClientFolder(clientName, clientPhone, parentFolderId) {
  const driveClient = getAuthClient();
  if (!driveClient) return { success: false, error: 'Drive not configured' };

  try {
    const folderName = `${clientName} - ${clientPhone}`;
    const response = await driveClient.files.create({
      resource: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      },
      fields: 'id, name'
    });

    return { success: true, folderId: response.data.id, folderName: response.data.name };
  } catch (error) {
    console.error('Drive folder creation error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { uploadFile, createClientFolder };
