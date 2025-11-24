const WebSocket = require('ws');

// Set to hold all connected clients
const clients = new Set(); 
const WSS_PATH = '/ws';

function setupWebSocketServer(server) {
    const wss = new WebSocket.Server({ noServer: true });

    wss.on('connection', (ws) => {
        // Manage user connection
        clients.add(ws);
        console.log(' A new client connected.');

        ws.on('close', () => {
            // Manage user disconnection
            clients.delete(ws);
            console.log(' A client disconnected.');
        });

        ws.on('error', (error) => {
            console.error('WebSocket Error:', error.message);
            clients.delete(ws);
        });
    });

    // Attach the WebSocket server handler to the HTTP server's 'upgrade' event
    server.on('upgrade', (request, socket, head) => {
        if (request.url === WSS_PATH) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });

    console.log(`WebSocket Server configured on ${WSS_PATH}`);
}

/**
 * Broadcasts an event message to all connected clients.
 * This function will be called by the file operation handlers in server.js/pipeline.js.
 * * @param {string} event - The type of event (e.g., 'file_uploaded').
 * @param {object} data - Specific data related to the event (e.g., filename, oldName).
 */
function broadcastEvent(event, data) {
    const message = JSON.stringify({
        event: event,
        ...data,
        timestamp: Date.now()
    });

    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

module.exports = {
    setupWebSocketServer,
    broadcastEvent
};