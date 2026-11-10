/** Metadata values come from package.json, so they arrive as unknown. */
function metaText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function generateOpenApiSpec(pkg: Record<string, unknown>, port: number) {
  return {
    openapi: "3.1.0",
    info: {
      title: metaText(pkg.name, "Baileys WA API"),
      version: metaText(pkg.version, "1.0.0"),
      description:
        `${metaText(pkg.description, "Production-ready WhatsApp REST API powered by Baileys WA Socket.")}<br><br>\n` +
        "<strong>Features:</strong><br>\n" +
        "- Multi-session management (QR code & pairing code)<br>\n" +
        "- Complete chat operations (send, bulk send, forward, delete, edit, read)<br>\n" +
        "- Broadcast queue with anti-spam delays<br>\n" +
        "- Full group management (create, participants, settings, invite)<br>\n" +
        "- Profile management (status, name, picture, block/unblock)<br>\n" +
        "- Story/status sharing<br>\n" +
        "- Media download and retrieval<br>\n" +
        "- Webhook with retry & exponential backoff<br>\n" +
        "- Dual auth (file-based + Redis)<br>\n" +
        "- API key authentication",
      contact: { name: metaText(pkg.author, "KoiN CoDeveloper") },
    },
    servers: [
      { url: `http://localhost:${port}`, description: "Local development" },
      {
        url: "{scheme}://{host}",
        description: "Custom server",
        variables: {
          scheme: { enum: ["http", "https"], default: "https" },
          host: { default: "your-domain.com" },
        },
      },
    ],
    tags: [
      { name: "Status", description: "Server health and status" },
      { name: "Sessions", description: "WhatsApp session management" },
      {
        name: "Chats",
        description: "Chat operations — send, read, delete, edit, bulk send, reaction, poll",
      },
      { name: "Groups", description: "Group management — create, participants, settings" },
      { name: "Profile", description: "Profile management — status, name, picture, block" },
      { name: "Media", description: "Media download and retrieval" },
      { name: "Story", description: "Story/status broadcasting" },
      { name: "Config", description: "Server configuration (read-only)" },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Simple token authentication (AUTH_GLOBAL_TOKEN)",
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: "Hashed API key created in Dashboard → REST API (scoped to sessions).",
        },
      },
      schemas: {
        ApiResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
            data: { type: "object", nullable: true },
          },
        },
        ApiError: {
          type: "object",
          description:
            "Structured failure. code is stable, field points at the request field, hint explains the fix.",
          properties: {
            success: { type: "boolean", example: false },
            code: { type: "string", example: "SESSION_NOT_CONNECTED" },
            message: { type: "string" },
            field: { type: "string", example: "from" },
            hint: { type: "string" },
            details: { type: "object", nullable: true },
            retryable: { type: "boolean" },
            requestId: { type: "string" },
          },
        },
        SessionCreate: {
          type: "object",
          properties: {
            clientName: { type: "string", description: "Client browser name", example: "Chrome" },
            webhookUrl: {
              type: "string",
              format: "uri",
              description: "Webhook URL for events",
              example: "http://localhost:3001/webhook",
            },
            webhookSecret: {
              type: "string",
              description: "Optional webhook secret sent in x-webhook-secret header",
              example: "my-webhook-secret",
            },
            freshAuth: {
              type: "boolean",
              description: "Delete old auth state before creating session",
              default: false,
            },
            usePairingCode: {
              type: "boolean",
              description: "Use pairing code instead of QR",
              default: false,
            },
            phoneNumber: {
              type: "string",
              description: "Phone number for pairing code (with country code)",
              example: "+6281234567890",
            },
            includeMedia: {
              type: "boolean",
              description: "Include media as base64 in webhooks",
              default: false,
            },
            syncFullHistory: {
              type: "boolean",
              description: "Sync full message history",
              default: false,
            },
          },
        },
        SendMessage: {
          type: "object",
          required: ["receiver", "message"],
          properties: {
            receiver: {
              type: "string",
              description: "Receiver phone number or group JID",
              example: "6281234567890",
            },
            message: {
              type: "object",
              description: "Message content (Baileys AnyMessageContent format)",
              example: { text: "Hello from Baileys WA API!" },
            },
            isGroup: { type: "boolean", description: "Is receiver a group", default: false },
          },
        },
        SendBulk: {
          type: "object",
          required: ["messages"],
          properties: {
            messages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  receiver: { type: "string", example: "6281234567890" },
                  message: { type: "object", example: { text: "Broadcast message" } },
                  delay: { type: "number", description: "Custom delay in ms (optional)" },
                },
              },
            },
          },
        },
        GroupCreate: {
          type: "object",
          required: ["groupName", "participants"],
          properties: {
            groupName: { type: "string", example: "My Group" },
            participants: {
              type: "array",
              items: { type: "string" },
              example: ["6281234567890", "6281234567891"],
            },
          },
        },
        ParticipantsUpdate: {
          type: "object",
          required: ["participants", "action"],
          properties: {
            participants: { type: "array", items: { type: "string" }, example: ["6281234567890"] },
            action: {
              type: "string",
              enum: ["add", "remove", "promote", "demote"],
              example: "add",
            },
          },
        },
        BroadcastJob: {
          type: "object",
          properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "running", "completed", "cancelled", "failed"],
            },
            progress: { type: "number" },
            total: { type: "number" },
            errors: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
    paths: {
      "/status": {
        get: {
          tags: ["Status"],
          summary: "Server health check",
          responses: { 200: { description: "Server status info" } },
        },
      },
      "/sessions": {
        get: {
          tags: ["Sessions"],
          summary: "List all active sessions",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          responses: { 200: { description: "List of sessions" } },
        },
      },
      "/sessions/{sessionId}": {
        post: {
          tags: ["Sessions"],
          summary: "Create a new session",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SessionCreate" } },
            },
          },
          responses: {
            200: { description: "Session created — returns QR code or pairing code" },
          },
        },
        get: {
          tags: ["Sessions"],
          summary: "Get session status",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Session status" } },
        },
        delete: {
          tags: ["Sessions"],
          summary: "Delete/logout a session",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Session deleted" } },
        },
      },
      "/sessions/{sessionId}/qr": {
        get: {
          tags: ["Sessions"],
          summary: "Get QR code for pending session",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "QR code data URL" } },
        },
      },
      "/api/v1/messages": {
        post: {
          tags: ["Messages"],
          summary: "Send text, image, document or location (unified)",
          description:
            "Canonical path. /messages remains as an alias. from accepts a session id or its bound phone number (a key is bound to one session). Group targets require ALLOW_GROUP_SEND=true (and ALLOWED_GROUP_JIDS when set). A public JSON Schema is available at /api/v1/messages/schema.",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["from", "receiver"],
                  properties: {
                    from: { type: "string", example: "ROG8" },
                    receiver: { type: "string", example: "628123456789" },
                    type: {
                      type: "string",
                      enum: ["text", "image", "document", "location"],
                      default: "text",
                    },
                    messages: { type: "string", example: "Halo dari bot" },
                    media: {
                      type: "object",
                      properties: {
                        url: { type: "string", format: "uri" },
                        filename: { type: "string" },
                        mimetype: { type: "string" },
                      },
                    },
                    location: {
                      type: "object",
                      properties: {
                        latitude: { type: "number" },
                        longitude: { type: "number" },
                        name: { type: "string" },
                        address: { type: "string" },
                      },
                    },
                    isGroup: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Message sent",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      data: {
                        type: "object",
                        properties: {
                          messageId: { type: "string", nullable: true },
                          to: { type: "string" },
                          type: { type: "string" },
                          timestamp: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: "INVALID_REQUEST or RECEIVER_NOT_ON_WHATSAPP",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
              },
            },
            401: {
              description: "UNAUTHORIZED",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
              },
            },
            403: {
              description: "KEY_NOT_SCOPED, GROUP_DISABLED or GROUP_NOT_ALLOWED",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
              },
            },
            404: {
              description: "SESSION_NOT_FOUND",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
              },
            },
            409: {
              description: "SESSION_NOT_CONNECTED (retryable)",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
              },
            },
            500: {
              description: "SEND_FAILED (retryable)",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
              },
            },
          },
        },
      },
      "/api/v1/messages/schema": {
        get: {
          tags: ["Messages"],
          summary: "Request JSON Schema for the unified send endpoint",
          description: "Public contract for LLM tool definitions and external validators.",
          responses: { 200: { description: "JSON Schema (draft-07)" } },
        },
      },
      "/chats/{sessionId}/send": {
        post: {
          tags: ["Chats"],
          summary: "Send a message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SendMessage" } },
            },
          },
          responses: { 200: { description: "Message sent" } },
        },
      },
      "/chats/send": {
        post: {
          tags: ["Chats"],
          summary: "Send a message (static endpoint)",
          description:
            "Third-party friendly endpoint. Pass sessionId in request body instead of URL path.",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/SendMessage" },
                    {
                      type: "object",
                      required: ["sessionId"],
                      properties: {
                        sessionId: { type: "string", example: "my-session" },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: { 200: { description: "Message sent" } },
        },
      },
      "/chats/{sessionId}/reaction": {
        post: {
          tags: ["Chats"],
          summary: "Send a reaction to a message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["jid", "messageId", "text"],
                  properties: {
                    jid: { type: "string", description: "Chat JID" },
                    messageId: { type: "string", description: "ID of the message to react to" },
                    text: { type: "string", description: "Emoji reaction (e.g., '👍')" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Reaction sent" } },
        },
      },
      "/chats/{sessionId}/poll": {
        post: {
          tags: ["Chats"],
          summary: "Send a poll message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["receiver", "name", "values"],
                  properties: {
                    receiver: { type: "string", description: "Receiver phone number or group JID" },
                    name: { type: "string", description: "Poll question" },
                    values: {
                      type: "array",
                      items: { type: "string" },
                      description: "Poll options",
                    },
                    selectableCount: {
                      type: "integer",
                      description: "How many options can be selected",
                      default: 1,
                    },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Poll sent" } },
        },
      },
      "/chats/{sessionId}/send-bulk": {
        post: {
          tags: ["Chats"],
          summary: "Send bulk messages with anti-spam delay",
          description:
            "Creates a broadcast job that sends messages with randomized delays. Returns a job ID for tracking progress.",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/SendBulk" } } },
          },
          responses: { 200: { description: "Broadcast job created" } },
        },
      },
      "/chats/{sessionId}/broadcast/{jobId}": {
        get: {
          tags: ["Chats"],
          summary: "Get broadcast job status",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "jobId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Broadcast job status",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/BroadcastJob" } },
              },
            },
          },
        },
        delete: {
          tags: ["Chats"],
          summary: "Cancel a broadcast job",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "jobId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Job cancelled" } },
        },
      },
      "/chats/{sessionId}/forward": {
        post: {
          tags: ["Chats"],
          summary: "Forward a message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Message forwarded" } },
        },
      },
      "/chats/{sessionId}/message": {
        delete: {
          tags: ["Chats"],
          summary: "Delete a message for everyone",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Message deleted" } },
        },
        patch: {
          tags: ["Chats"],
          summary: "Edit a previously sent message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Message edited" } },
        },
      },
      "/chats/{sessionId}/read": {
        post: {
          tags: ["Chats"],
          summary: "Mark messages as read",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Messages read" } },
        },
      },
      "/chats/{sessionId}/presence": {
        post: {
          tags: ["Chats"],
          summary: "Send presence update (typing, recording)",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Presence updated" } },
        },
      },
      "/chats/{sessionId}/on-whatsapp": {
        post: {
          tags: ["Chats"],
          summary: "Check if phone numbers are on WhatsApp",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Check results" } },
        },
      },
      "/chats/{sessionId}/list": {
        get: {
          tags: ["Chats"],
          summary: "Get chat list from store",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Chat list" } },
        },
      },
      "/groups/{sessionId}/create": {
        post: {
          tags: ["Groups"],
          summary: "Create a new group",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/GroupCreate" } },
            },
          },
          responses: { 200: { description: "Group created" } },
        },
      },
      "/groups/{sessionId}/list": {
        get: {
          tags: ["Groups"],
          summary: "List groups from store",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Group list" } },
        },
      },
      "/groups/{sessionId}/metadata/{jid}": {
        get: {
          tags: ["Groups"],
          summary: "Get group metadata",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "jid", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Group metadata" } },
        },
      },
      "/groups/{sessionId}/participants/{jid}": {
        post: {
          tags: ["Groups"],
          summary: "Update group participants",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "jid", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ParticipantsUpdate" } },
            },
          },
          responses: { 200: { description: "Participants updated" } },
        },
      },
      "/profile/{sessionId}": {
        get: {
          tags: ["Profile"],
          summary: "Get own profile info",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Profile info" } },
        },
      },
      "/profile/{sessionId}/status": {
        patch: {
          tags: ["Profile"],
          summary: "Update profile status text",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Status updated" } },
        },
      },
      "/profile/{sessionId}/block": {
        post: {
          tags: ["Profile"],
          summary: "Block or unblock a user",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "User blocked/unblocked" } },
        },
      },
      "/media/{sessionId}/download": {
        post: {
          tags: ["Media"],
          summary: "Download media from a message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Media content (base64)" } },
        },
      },
      "/media/file/{id}": {
        get: {
          tags: ["Media"],
          summary: "Retrieve a saved media file",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Media file" } },
        },
      },
      "/chats/{sessionId}/conversation/{jid}": {
        get: {
          tags: ["Chats"],
          summary: "Get conversation messages from a chat",
          description:
            "Load stored messages from a specific chat. Use ?limit=N to control count (default 25).",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "jid", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          ],
          responses: { 200: { description: "List of messages" } },
        },
      },
      "/chats/{sessionId}/download-media": {
        post: {
          tags: ["Chats"],
          summary: "Download media from a stored message",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["remoteJid", "messageId"],
                  properties: { remoteJid: { type: "string" }, messageId: { type: "string" } },
                },
              },
            },
          },
          responses: { 200: { description: "Media content (base64)" } },
        },
      },
      "/story/{sessionId}/share": {
        post: {
          tags: ["Story"],
          summary: "Share a story/status to contacts",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Story shared" } },
        },
      },
      "/config/simulation": {
        get: {
          tags: ["Config"],
          summary: "Get WA Web behavior simulation settings",
          description: "Returns current simulation config (read-only, set via .env)",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          responses: { 200: { description: "Simulation config" } },
        },
      },
    },
  };
}
