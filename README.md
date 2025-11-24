# 📄 File Management System Documentation

## 1. System Architecture

This project implements a modular, stream-based, real-time file management system using Node.js core modules and the `ws` library for WebSocket communication.

| Component | Role Description |
| :--- | :--- |
| **`server.js`** | **Core HTTP Router:** Manages all client HTTP requests (CRUD, metadata, compression/encryption triggers). It attaches the WebSocket server and exposes the `/api/files/:fileName` endpoint. |
| **`pipeline.js`** | **File Processing Layer:** Executes complex stream transformations (**Gzip** and **AES-256**) using `zlib` and `crypto`. It ensures non-blocking I/O and calls the `broadcastEvent` on successful completion. |
| **`websocket.js`** | **Real-Time Event System:** Manages the WebSocket server (`ws`), tracks active clients, and provides the central **`broadcastEvent`** function used by other modules to notify all users of changes. |
| **`uploads/`** | **Storage:** Stores all original, compressed, and encrypted files. |

**Operation Flow**
The system operates on an event-driven flow:

1.  **Request:** A user sends an HTTP request (e.g., `DELETE /uploads/:fileName`).
2.  **Execution:** The appropriate handler in `server.js` executes the operation using **asynchronous Streams**.
3.  **Success:** Upon successful completion, the system returns an HTTP success code (`200 OK`).
4.  **Notification:** The success handler calls `broadcastEvent`, notifying all other clients via WebSocket about the event (`file_deleted`).

***

## 2. 🌊 Stream-Based Architecture 

**A. Why are Streams necessary for large files?**

Streams are essential for **scalability** and preventing **Memory Overflow**. Instead of **buffering** (loading the entire file into RAM) before processing, streams process data in small, sequential **chunks**. This ensures the server can handle files of **any size** without consuming excessive system memory or blocking the Node.js event loop.

**B. Backpressure Explanation (backpressure)**

**Backpressure** is a flow control mechanism crucial for stability. It occurs when a **Writable Stream** (the consumer, e.g., disk write) cannot consume data as fast as the **Readable Stream** (the producer, e.g., network read) is generating it. The `.pipe()` method automatically manages backpressure by pausing the producer when the consumer's internal buffer fills up, and resuming it once the consumer is ready.

**C. Difference between `readFile/writeFile` and `ReadStream/WriteStream`**

| Feature | `fs.readFile` / `fs.writeFile` | `fs.createReadStream` / `fs.createWriteStream` |
| :--- | :--- | :--- |
| **Data Handling** | **Buffers** the entire file content into RAM. | **Streams** data chunk-by-chunk; minimal RAM usage. |
| **Suitability** | Small configuration files, simple scripts. | **Large files, network I/O, chaining processors (Pipeline).** |
| **Flow Control** | No backpressure control. | Built-in backpressure handling (`.pipe()`). |

***

## 3. 📋 Complete Use Case Flow (Use Case)

The following three screenshots prove the integrated real-time functionality of the system.

#### **1. Request: POST /uploads/:fileName**

* **Action:** Send a `POST` request to upload a file (e.g., `testing`).
* **Proof:** Displaying the successful request, the file path, and the **Status: 201 Created** response.

![Successful POST Upload](assets/post_upload_success.png)

***

#### **2. WebSocket Message (upload\_success)**

* **Action:** Observe the connected WebSocket client after the successful upload.
* **Proof:** Displaying the connected client receiving the `{"event": "file_uploaded", "filename": "testing", ...}` JSON message.

![WebSocket Event Broadcast](assets/websocket_event_received.png)

***

#### **3. Request: GET /api/files/:fileName for Metadata**

* **Action:** Send a `GET` request using the file ID to retrieve its metadata (Name, Size, Upload Date).
* **Proof:** Displaying the `GET` request to the `/api/files/testing` endpoint and the `200 OK` response containing the file's metadata object.

![Successful GET Metadata](assets/get_metadata_success.png)
