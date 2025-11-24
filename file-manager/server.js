const { handleFileCompression, handleFileEncryption } = require('./pipeline');
const { setupWebSocketServer, broadcastEvent } = require('./websocket'); 
const http = require('http')
const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PORT = 3000;

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

function sendJsonResponse(res, statusCode, message, data = {}) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message, ...data }));
}

class FileUploadParser extends Writable {
    constructor(filePath, boundary, options) {
        super(options);
        this.boundary = Buffer.from('--' + boundary);
        this.filePath = filePath;
        this.fileStream = null;
        this.fileStarted = false;
        this.fileFinished = false;
        this.headerBuffer = Buffer.alloc(0);
        this.isFile = false;
    }

    _isStartOfFile(chunk) {
        return chunk.toString('latin1').includes('filename=') && chunk.toString('latin1').includes('Content-Type');
    }

    _write(chunk, encoding, callback) {
        if (this.fileFinished) {
            return callback();
        }

        if (!this.fileStarted) {
            this.headerBuffer = Buffer.concat([this.headerBuffer, chunk]);

            if (this.headerBuffer.includes(this.boundary)) {
                let headerString = this.headerBuffer.toString('latin1');
                
                if (this._isStartOfFile(this.headerBuffer)) {
                    this.fileStarted = true;
                    this.fileStream = fs.createWriteStream(this.filePath);
                    
                    let dataStart = headerString.indexOf('\r\n\r\n');
                    
                    if (dataStart !== -1) {
                        let dataChunk = this.headerBuffer.slice(dataStart + 4);
                        this.fileStream.write(dataChunk);
                    } else {
                    }
                } else {
                }

                this.headerBuffer = Buffer.alloc(0);
            }

            return callback();
        }

        if (this.fileStream) {
            let boundaryIndex = chunk.indexOf(this.boundary);

            if (boundaryIndex !== -1) {
                this.fileStream.write(chunk.slice(0, boundaryIndex - 2));
                this.fileStream.end();
                this.fileFinished = true;
                this.emit('file-complete');
                return callback();
            } else {
                this.fileStream.write(chunk, callback);
            }
        } else {
            callback();
        }
    }

    _final(callback) {
        if (this.fileStream && !this.fileFinished) {
            this.fileStream.end();
            this.emit('file-complete');
        }
        callback();
    }
}


const server = http.createServer((req, res) => {
    const { method, url, headers } = req;
    const urlParts = url.split('/').filter(p => p.length > 0);

    req.on('error', (err) => {
        console.error('Request Stream Error:', err.message);
        sendJsonResponse(res, 500, 'Request stream error.');
    });


    if (method === 'POST' && urlParts[0] === 'uploads' && urlParts.length === 2) {
        const originalFilename = urlParts[1];
        const filePath = path.join(UPLOADS_DIR, originalFilename);
        const contentType = headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=([^;]+)/);

        if (!boundaryMatch) {
            return sendJsonResponse(res, 400, 'Invalid Content-Type or missing boundary for file upload.');
        }

        const boundary = boundaryMatch[1];
        const parser = new FileUploadParser(filePath, boundary);

        parser.on('error', (err) => {
            console.error('File Write Error:', err.message);
            fs.unlink(filePath, () => {}); 
            sendJsonResponse(res, 500, `File upload failed: ${err.message}`);
        });

        parser.fileStream && parser.fileStream.on('error', (err) => {
            console.error('WriteStream Error:', err.message);
            fs.unlink(filePath, () => {});
            sendJsonResponse(res, 500, `File system error: ${err.code || err.message}`);
        });

        parser.on('file-complete', () => {
            if (!res.headersSent) {
                sendJsonResponse(res, 201, 'File uploaded successfully.', { filename: originalFilename });
                //Broadcast
                broadcastEvent('file_uploaded', { filename: originalFilename });
            }
        });

        req.pipe(parser);

        return;
    }


    if (method === 'GET' && urlParts[0] === 'uploads' && urlParts.length === 2) {
        const filename = urlParts[1];
        const filePath = path.join(UPLOADS_DIR, filename);

        fs.stat(filePath, (err, stats) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    return sendJsonResponse(res, 404, 'File Not Found.');
                }
                return sendJsonResponse(res, 500, 'Internal Server Error (FS Stat).');
            }

            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': stats.size,
                'Content-Disposition': `attachment; filename="${filename}"`, 
                'Transfer-Encoding': 'chunked'
            });

            const fileReadStream = fs.createReadStream(filePath);
            
            fileReadStream.pipe(res);

            fileReadStream.on('error', (readErr) => {
                console.error('File Read Error:', readErr.message);
                if (!res.headersSent) {
                    sendJsonResponse(res, 500, 'Error reading file.');
                } else {
                    res.end();
                }
            });
        });
        return;
    }

    if (method === 'DELETE' && urlParts[0] === 'uploads' && urlParts.length === 2) {
        const filename = urlParts[1];
        const filePath = path.join(UPLOADS_DIR, filename);

        fs.unlink(filePath, (err) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    return sendJsonResponse(res, 404, 'File Delete Failed: File Not Found.');
                }
                return sendJsonResponse(res, 500, 'Internal Server Error during file deletion.');
            }
            sendJsonResponse(res, 200, 'File deleted successfully.');
            broadcastEvent('file_deleted', { filename: filename });
        });
        return;
    }

    if (method === 'PUT' && urlParts[0] === 'uploads' && urlParts.length === 2) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            const oldName = urlParts[1];
            let newName;
            try {
                const data = JSON.parse(body);
                newName = data.newName;

                if (!newName) {
                    return sendJsonResponse(res, 400, 'Missing "newName" parameter in request body.');
                }
            } catch (e) {
                return sendJsonResponse(res, 400, 'Invalid JSON body.');
            }

            const oldPath = path.join(UPLOADS_DIR, oldName);
            const newPath = path.join(UPLOADS_DIR, newName);

            fs.access(oldPath, fs.constants.F_OK, (err) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        return sendJsonResponse(res, 404, 'Rename Failed: Old File Not Found.');
                    }
                    return sendJsonResponse(res, 500, 'Internal Server Error (FS Access).');
                }

                fs.access(newPath, fs.constants.F_OK, (err) => {
                    if (!err) {
                        return sendJsonResponse(res, 409, 'Rename Failed: A file with the new name already exists (Overwrite Prevention).');
                    }
                    
                    if (err.code !== 'ENOENT') {
                        return sendJsonResponse(res, 500, 'Internal Server Error (FS Access New Path).');
                    }

                    fs.rename(oldPath, newPath, (err) => {
                        if (err) {
                            return sendJsonResponse(res, 500, `Internal Server Error: ${err.message}`);
                        }
                        broadcastEvent('file_renamed', { oldName, newName });
                        });
                });
            });
        });
        return;
    }
    //second question
    if (method === 'GET' && urlParts[0] === 'compress' && urlParts.length === 2) {
        handleFileCompression(req, res, UPLOADS_DIR, sendJsonResponse);
        return;
    }
    //GET /encrypt/:filename) ---
    if (method === 'GET' && urlParts[0] === 'encrypt' && urlParts.length === 2) {
        handleFileEncryption(req, res, UPLOADS_DIR, sendJsonResponse);
        return;
    }
    // q4:GET /api/files/:filename for Metadata ---
    if (method === 'GET' && urlParts[0] === 'api' && urlParts[1] === 'files' && urlParts.length === 3) {
        const filename = urlParts[2];
        const filePath = path.join(UPLOADS_DIR, filename);

        fs.stat(filePath, (err, stats) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    return sendJsonResponse(res, 404, 'File Metadata Not Found.');
                }
                return sendJsonResponse(res, 500, 'Internal Server Error (FS Stat).');
            }

            const metadata = {
                filename: filename,
                size_bytes: stats.size, 
                created_at: stats.birthtime, 
                is_directory: stats.isDirectory()
            };
            
            sendJsonResponse(res, 200, 'File metadata retrieved successfully.', { metadata: metadata });
        });
        return;
    }
    sendJsonResponse(res, 404, `Cannot ${method} ${url}`);
});

setupWebSocketServer(server);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Uploads directory: ${UPLOADS_DIR}`);
});