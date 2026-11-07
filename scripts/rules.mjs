// Security rules generated from team.json. Only signed-in team members with a
// verified Google email can read or write anything. Agent results and the
// agent log are written by the server (Admin SDK) and are read-only to people,
// except the review fields on a draft.

const list = (team) => team.map((e) => `'${e.replace(/'/g, "")}'`).join(", ");

export function buildFirestoreRules(team) {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isTeam() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower() in [${list(team)}];
    }

    match /jobs/{jobId} {
      allow read, create, update, delete: if isTeam();

      match /supplementDrafts/{draftId} {
        allow read, delete: if isTeam();
        // People may only change review fields; EL JEFFE's own output is written by the server.
        allow update: if isTeam() && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['items', 'letterOverride', 'status', 'reviewNote', 'decidedAt', 'decidedBy', 'updatedAt'])
          && request.resource.data.status in ['Needs Review', 'Approved', 'Rejected'];
        allow create: if false;
      }
      match /chat/{msgId} {
        allow read, delete: if isTeam();
        allow create: if isTeam() && request.resource.data.role == 'user';
        allow update: if false;
      }
    }
    match /knowledge/{id} { allow read, write: if isTeam(); }
    match /settings/{id} { allow read, write: if isTeam(); }
  }
}
`;
}

export function buildStorageRules(team) {
  return `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isTeam() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower() in [${list(team)}];
    }
    match /documents/{jobId}/{file} {
      allow read, delete: if isTeam();
      allow create, update: if isTeam()
        && request.resource.size < 30 * 1024 * 1024
        && (request.resource.contentType == 'application/pdf' || request.resource.contentType.matches('image/(jpeg|png|webp)'));
    }
  }
}
`;
}
