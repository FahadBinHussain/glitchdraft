# Data Model and Contracts

## Draft Object

```json
{
  "html": "<p>Message</p>",
  "timestamp": 1710000000000
}
```

## Backend Tables

### `drafts`

- `thread_id` (PK, text)
- `messages` (jsonb array of draft objects)
- `contact_name` (text, nullable)
- `last_modified` (bigint)
- `updated_at` (timestamp)

### `settings`

- `id` (PK, text, expected `"user"`)
- `ui_positions` (jsonb object)
- `app_config` (jsonb object)
- `updated_at` (timestamp)

## Extension Storage Keys

- `firebaseConfig`
- `neonConfig`
  - `{ apiBaseUrl, apiKey }`
- `lastSyncTime`
- local position cache keys:
  - `glitchdraft_pos_<hostname>`

## Extension-to-Background Action Payloads

### `saveDraft`

```json
{
  "action": "saveDraft",
  "chatId": "string",
  "messages": [],
  "contactName": "string|null"
}
```

### `getDraft`

```json
{
  "action": "getDraft",
  "chatId": "string"
}
```

### `saveSettings`

```json
{
  "action": "saveSettings",
  "settings": {
    "uiPositions": {},
    "appConfig": {}
  }
}
```

## Backend Auth Header

Required header:

```http
x-api-key: <API_KEY>
```
