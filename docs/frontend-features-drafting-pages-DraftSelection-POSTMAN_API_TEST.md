# Postman API Test Guide - Draft Template Service

## Update Draft Fields API

### Endpoint
```
PUT http://localhost:5000/api/drafts/{draftId}/fields
```

### Headers
```
Content-Type: application/json
Authorization: Bearer {your_jwt_token}
```

### Request Body
```json
{
  "fields": {
    "deed_date": "2026-01-28",
    "effective_date": "2026-01-28",
    "house_owner_name": "John Smith",
    "house_owner_address": "123 Main Street, City, State 12345",
    "tenant_name": "Jane Doe",
    "tenant_age": 30,
    "tenant_address": "456 Oak Avenue, City, State 67890",
    "property_address": "123 Main Street, City, State 12345",
    "tenancy_period": "12 months",
    "tenancy_start_date": "2026-02-01",
    "monthly_rent": 25000,
    "monthly_rent_words": "Twenty Five Thousand Only",
    "association_name": "ABC Housing Association",
    "rent_advance_amount": 50000,
    "rent_advance_amount_words": "Fifty Thousand Only",
    "number_of_main_door_keys": 2,
    "number_of_bedroom_keys": 3,
    "number_of_tube_lights": 4,
    "number_of_bulbs": 6,
    "place": "Mumbai"
  }
}
```

### Example Request (Single Field)
```json
{
  "fields": {
    "house_owner_name": "John Smith"
  }
}
```

### Expected Success Response (200 OK)
```json
{
  "success": true,
  "versionId": "new-version-uuid",
  "versionNo": 2
}
```

### Expected Error Responses

#### 400 Bad Request - Missing Fields
```json
{
  "success": false,
  "error": "MISSING_FIELDS",
  "message": "fields object is required"
}
```

#### 404 Not Found - Draft Not Found
```json
{
  "success": false,
  "error": "DRAFT_NOT_FOUND",
  "message": "Draft not found"
}
```

#### 400 Bad Request - Draft Finalized
```json
{
  "success": false,
  "error": "DRAFT_FINALIZED",
  "message": "Cannot edit a finalized draft"
}
```

---

## Get Draft API (To Verify Changes)

### Endpoint
```
GET http://localhost:5000/api/drafts/{draftId}
```

### Headers
```
Authorization: Bearer {your_jwt_token}
```

### Expected Success Response (200 OK)
```json
{
  "success": true,
  "draft": {
    "id": "draft-uuid",
    "title": "new file Rend aggrement - Draft",
    "status": "draft",
    "templateName": "new file Rend aggrement",
    "templateVersionId": "ee94142f-28f1-4c64-8563-df05cf29fbd5",
    "currentVersionId": "new-version-uuid",
    "schema": {
      "fields": [
        {
          "key": "deed_date",
          "type": "date",
          "label": "Deed Date"
        },
        ...
      ]
    },
    "blocks": [
      {
        "id": "block-uuid",
        "key": "deed_date",
        "content": {
          "value": "2026-01-28",
          "label": "Deed Date",
          "type": "date"
        }
      },
      ...
    ],
    "createdAt": "2026-01-28T11:01:22.741455Z",
    "updatedAt": "2026-01-28T11:01:22.741455Z"
  }
}
```

---

## Create Draft API (To Get Draft ID)

### Endpoint
```
POST http://localhost:5000/api/drafts
```

### Headers
```
Content-Type: application/json
Authorization: Bearer {your_jwt_token}
```

### Request Body
```json
{
  "templateId": "99b5b4bf-7ce1-4e62-b402-313b0e49819c",
  "title": "Test Draft - Rent Agreement"
}
```

### Expected Success Response (201 Created)
```json
{
  "success": true,
  "draft": {
    "id": "draft-uuid-here",
    "title": "Test Draft - Rent Agreement",
    "status": "draft",
    "templateVersionId": "ee94142f-28f1-4c64-8563-df05cf29fbd5",
    "currentVersionId": "version-uuid",
    "createdAt": "2026-01-28T..."
  }
}
```

---

## Complete Test Flow

1. **Get JWT Token** (from login)
   ```
   POST http://localhost:5000/auth/api/auth/signin
   Body: { "email": "...", "password": "..." }
   ```

2. **Create Draft** (to get draftId)
   ```
   POST http://localhost:5000/api/drafts
   Body: { "templateId": "99b5b4bf-7ce1-4e62-b402-313b0e49819c" }
   ```
   Copy the `draft.id` from response

3. **Update Draft Fields**
   ```
   PUT http://localhost:5000/api/drafts/{draftId}/fields
   Body: { "fields": { "house_owner_name": "John Smith" } }
   ```

4. **Verify Changes**
   ```
   GET http://localhost:5000/api/drafts/{draftId}
   ```
   Check `draft.blocks[]` for updated values

---

## Field Keys Reference (from your schema)

Based on your template schema, here are all available field keys:

- `deed_date` (date)
- `effective_date` (date)
- `house_owner_name` (string)
- `house_owner_address` (address)
- `tenant_name` (string)
- `tenant_age` (number)
- `tenant_address` (address)
- `property_address` (address)
- `tenancy_period` (string)
- `tenancy_start_date` (date)
- `monthly_rent` (currency)
- `monthly_rent_words` (string)
- `association_name` (string)
- `rent_advance_amount` (currency)
- `rent_advance_amount_words` (string)
- `number_of_main_door_keys` (number)
- `number_of_bedroom_keys` (number)
- `number_of_tube_lights` (number)
- `number_of_bulbs` (number)
- `place` (string)

---

## Notes

- All endpoints go through the gateway at `http://localhost:5000`
- Gateway proxies to `http://localhost:5010` (drafting-template-service)
- JWT token is required for all requests
- Field updates create a new version (versioning system)
- Use the `draftId` from the create draft response
