const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { broadcastEvent } = require('./websocket');
const ENCRYPTION_KEY = crypto.randomBytes(32); 
const IV = crypto.randomBytes(16);

function handleFileCompression(req, res, UPLOADS_DIR, sendJsonResponse) {
    const urlParts = req.url.split('/').filter(p => p.length > 0);
    const filename = urlParts[1];
    const originalPath = path.join(UPLOADS_DIR, filename);
    const compressedFilename = filename + '.gz';
    const compressedPath = path.join(UPLOADS_DIR, compressedFilename);

    fs.stat(originalPath, (err) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return sendJsonResponse(res, 404, 'Compression Failed: Original File Not Found.');
            }
            return sendJsonResponse(res, 500, 'Internal Server Error (FS Stat).');
        }

        const readStream = fs.createReadStream(originalPath);
        const writeStream = fs.createWriteStream(compressedPath);
        const gzip = zlib.createGzip();
        
        readStream.pipe(gzip).pipe(writeStream);

        const errorHandler = (pipelineErr) => {
            console.error('Compression Pipeline Error:', pipelineErr.message);
            fs.unlink(compressedPath, () => {}); 
            if (!res.headersSent) {
                sendJsonResponse(res, 500, `Compression Failed: ${pipelineErr.message}`);
            }
        };

        readStream.on('error', errorHandler);
        gzip.on('error', errorHandler);
        writeStream.on('error', errorHandler);
        
        writeStream.on('finish', () => {
            if (!res.headersSent) {
                sendJsonResponse(res, 200, 'File compressed successfully.', { 
                    original: filename, 
                    compressed: compressedFilename,
                    path: `/uploads/${compressedFilename}`
                });
                //broadcast
                broadcastEvent('file_compressed', { filename: compressedFilename });
            }
        });
    });
}

function handleFileEncryption(req, res, UPLOADS_DIR, sendJsonResponse) {
    const urlParts = req.url.split('/').filter(p => p.length > 0);
    const filename = urlParts[1];
    const originalPath = path.join(UPLOADS_DIR, filename);
    const encryptedFilename = filename + '.enc';
    const encryptedPath = path.join(UPLOADS_DIR, encryptedFilename);

    fs.stat(originalPath, (err) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return sendJsonResponse(res, 404, 'Encryption Failed: Original File Not Found.');
            }
            return sendJsonResponse(res, 500, 'Internal Server Error (FS Stat).');
        }

        const readStream = fs.createReadStream(originalPath);
        const writeStream = fs.createWriteStream(encryptedPath);
        
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, IV);
        
        readStream.pipe(cipher).pipe(writeStream);

        const errorHandler = (pipelineErr) => {
            console.error('Encryption Pipeline Error:', pipelineErr.message);
            fs.unlink(encryptedPath, () => {}); 
            if (!res.headersSent) {
                sendJsonResponse(res, 500, `Encryption Failed: ${pipelineErr.message}`);
            }
        };

        readStream.on('error', errorHandler);
        cipher.on('error', errorHandler);
        writeStream.on('error', errorHandler);

        writeStream.on('finish', () => {
            if (!res.headersSent) {
                sendJsonResponse(res, 200, 'File encrypted successfully.', { 
                    original: filename, 
                    encrypted: encryptedFilename,
                    path: `/uploads/${encryptedFilename}`,
                    key_used_iv: IV.toString('hex'), 
                    key_used_key: ENCRYPTION_KEY.toString('hex') 
                });
                broadcastEvent('file_encrypted', { filename: encryptedFilename });
            }
        });
    });
}

module.exports = {
    handleFileCompression,
    handleFileEncryption
};