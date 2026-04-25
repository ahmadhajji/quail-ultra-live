"""
Google API Integration

Fetches comments from Google Slides using the Drive API.
Comments are stored per-slide for integration with extracted content.
"""

import os
import json
import io
import re
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field

# These will be imported after user installs requirements
try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False


# Scopes required for accessing comments
SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/presentations.readonly'
]


@dataclass
class SlideComment:
    """A comment on a Google Slide."""
    slide_number: int
    author: str
    content: str
    created_time: str
    replies: list[str] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            "slide_number": self.slide_number,
            "author": self.author,
            "content": self.content,
            "created_time": self.created_time,
            "replies": self.replies
        }


def _resolve_base_dir() -> Path | None:
    raw = os.getenv("QBANK_BASE_DIR", "").strip()
    if not raw:
        return None
    return Path(raw).expanduser().resolve()


def resolve_google_credentials_path(credentials_path: str | Path | None = None) -> Path:
    raw = str(credentials_path).strip() if credentials_path is not None else ""
    if raw:
        return Path(raw).expanduser().resolve()

    explicit = os.getenv("GOOGLE_CREDENTIALS_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()

    base_dir = _resolve_base_dir()
    if base_dir is not None:
        return (base_dir / "credentials.json").resolve()

    return Path("credentials.json").resolve()


def resolve_google_token_path(token_path: str | Path | None = None) -> Path:
    raw = str(token_path).strip() if token_path is not None else ""
    if raw:
        return Path(raw).expanduser().resolve()

    explicit = os.getenv("GOOGLE_TOKEN_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()

    base_dir = _resolve_base_dir()
    if base_dir is not None:
        return (base_dir / "token.json").resolve()

    return Path("token.json").resolve()


def _resolve_credentials_path(credentials_path: str | Path | None) -> Path:
    return resolve_google_credentials_path(credentials_path)


def _resolve_token_path(token_path: str | Path | None) -> Path:
    return resolve_google_token_path(token_path)


def connect_google_oauth(
    credentials_path: str | Path | None = None,
    token_path: str | Path | None = None,
) -> Optional[Credentials]:
    """Run interactive OAuth flow and persist token."""
    if not GOOGLE_API_AVAILABLE:
        raise RuntimeError("Google API libraries not installed. Run: pip install -r requirements.txt")

    resolved_credentials = _resolve_credentials_path(credentials_path)
    resolved_token = _resolve_token_path(token_path)
    resolved_token.parent.mkdir(parents=True, exist_ok=True)

    if not resolved_credentials.exists():
        raise FileNotFoundError(
            f"Google OAuth client file not found: {resolved_credentials}. "
            "Set GOOGLE_CREDENTIALS_PATH or place credentials.json under QBANK_BASE_DIR."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(resolved_credentials), SCOPES)
    creds = flow.run_local_server(port=0)
    resolved_token.write_text(creds.to_json(), encoding="utf-8")
    return creds


def disconnect_google_oauth(token_path: str | Path | None = None) -> bool:
    """Delete persisted OAuth token if present."""
    resolved_token = _resolve_token_path(token_path)
    if resolved_token.exists():
        resolved_token.unlink()
        return True
    return False


def get_google_auth_identity(
    credentials_path: str | Path | None = None,
    token_path: str | Path | None = None,
) -> str | None:
    """Return connected Google identity email/name when available."""
    if not GOOGLE_API_AVAILABLE:
        return None
    resolved_token = _resolve_token_path(token_path)
    if not resolved_token.exists():
        return None
    try:
        creds = Credentials.from_authorized_user_file(str(resolved_token), SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                resolved_token.write_text(creds.to_json(), encoding="utf-8")
            else:
                return None
        drive_service = build("drive", "v3", credentials=creds)
        about = drive_service.about().get(fields="user(displayName,emailAddress)").execute()
        user = about.get("user", {})
        email = (user.get("emailAddress") or "").strip()
        name = (user.get("displayName") or "").strip()
        if email and name and email != name:
            return f"{name} <{email}>"
        return email or name or None
    except Exception:
        return None


def get_credentials(
    credentials_path: str | Path | None = None,
    token_path: str | Path | None = None,
) -> Optional[Credentials]:
    """
    Get or refresh Google API credentials.
    
    Args:
        credentials_path: Path to OAuth client credentials file
        token_path: Path to save/load user token
    
    Returns:
        Credentials object if successful, None otherwise
    """
    if not GOOGLE_API_AVAILABLE:
        print("Google API libraries not installed. Run: pip install -r requirements.txt")
        return None
    
    creds = None
    token_path = _resolve_token_path(token_path)
    credentials_path = _resolve_credentials_path(credentials_path)
    
    # Check for existing token
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        except Exception:
            creds = None
    
    # Refresh or get new credentials
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            try:
                creds = connect_google_oauth(
                    credentials_path=credentials_path,
                    token_path=token_path,
                )
            except FileNotFoundError:
                print(f"Credentials file not found: {credentials_path}")
                print(
                    "Google OAuth client file is missing. "
                    "Set GOOGLE_CREDENTIALS_PATH or place credentials.json under QBANK_BASE_DIR."
                )
                return None
            except Exception as exc:
                print(f"Google OAuth flow failed: {exc}")
                return None
        
        # Save credentials for next time
        with open(token_path, 'w') as token:
            token.write(creds.to_json())
    
    return creds


def get_presentation_id_from_url(url: str) -> Optional[str]:
    """Extract presentation ID from a Google Slides URL."""
    # URL format: https://docs.google.com/presentation/d/PRESENTATION_ID/edit
    match = re.search(r'/presentation/d/([a-zA-Z0-9_-]+)', url)
    if match:
        return match.group(1)
    return None


def extract_presentation_id(raw_input: str) -> str:
    """
    Extract and validate a Google Slides presentation ID from URL or raw ID.

    Raises:
        ValueError: If no valid ID could be parsed.
    """
    cleaned = (raw_input or "").strip()
    if not cleaned:
        raise ValueError("Google Slides input is empty.")

    parsed = get_presentation_id_from_url(cleaned)
    if parsed:
        return parsed

    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", cleaned):
        return cleaned

    raise ValueError(
        "Invalid Google Slides input. Expected a Slides URL like "
        "https://docs.google.com/presentation/d/<ID>/edit or a raw file ID."
    )


def fetch_presentation_title(
    presentation_id: str,
    credentials_path: str | Path | None = None,
) -> str:
    """
    Fetch presentation title from Google Slides API.

    Raises:
        RuntimeError: When API auth/setup is unavailable.
        ValueError: For invalid presentation ID.
        PermissionError: For access-denied style failures.
    """
    if not GOOGLE_API_AVAILABLE:
        raise RuntimeError("Google API libraries not installed.")

    try:
        creds = get_credentials(credentials_path)
    except Exception as e:
        raise RuntimeError(f"Unable to initialize Google credentials: {e}") from e
    if not creds:
        raise RuntimeError("Unable to initialize Google credentials.")

    try:
        slides_service = build("slides", "v1", credentials=creds)
        presentation = slides_service.presentations().get(
            presentationId=presentation_id
        ).execute()
        title = str(presentation.get("title", "")).strip()
        if not title:
            raise ValueError(f"Could not read title for presentation: {presentation_id}")
        return title
    except Exception as e:
        message = str(e).lower()
        if any(token in message for token in ("permission", "forbidden", "insufficient")):
            raise PermissionError(f"Access denied for presentation {presentation_id}") from e
        if "not found" in message or "invalid" in message:
            raise ValueError(f"Presentation not found or invalid: {presentation_id}") from e
        raise RuntimeError(f"Failed to fetch presentation title: {e}") from e


def export_presentation_to_pptx(
    presentation_id: str,
    out_path: str | Path,
    credentials_path: str | Path | None = None,
) -> Path:
    """
    Export a Google Slides deck to PPTX using Drive API.

    Raises:
        RuntimeError: When API auth/setup is unavailable.
        ValueError: For invalid presentation ID.
        PermissionError: For access-denied style failures.
    """
    destination = Path(out_path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)

    if GOOGLE_API_AVAILABLE:
        try:
            creds = get_credentials(credentials_path)
        except Exception:
            creds = None
        if creds:
            try:
                drive_service = build("drive", "v3", credentials=creds)
                request = drive_service.files().export_media(
                    fileId=presentation_id,
                    mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                )
                buffer = io.BytesIO()
                downloader = MediaIoBaseDownload(buffer, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
                destination.write_bytes(buffer.getvalue())
                if destination.stat().st_size == 0:
                    raise RuntimeError("Downloaded PPTX file is empty.")
                return destination
            except Exception:
                # Fall through to public export fallback.
                pass

    return _export_presentation_to_pptx_public(presentation_id, destination)


def _export_presentation_to_pptx_public(presentation_id: str, destination: Path) -> Path:
    """
    Fallback export path using public link sharing.

    Works for presentations accessible via shared link without OAuth.
    """
    export_url = f"https://docs.google.com/presentation/d/{presentation_id}/export/pptx"
    try:
        with urlopen(export_url, timeout=45) as response:
            data = response.read()
    except HTTPError as e:
        if e.code in (401, 403):
            raise PermissionError(
                f"Public export denied for presentation {presentation_id}. "
                "Check sharing permissions or re-authenticate Google OAuth."
            ) from e
        if e.code == 404:
            raise ValueError(f"Presentation not found: {presentation_id}") from e
        raise RuntimeError(f"Public export failed (HTTP {e.code}) for {presentation_id}") from e
    except URLError as e:
        raise RuntimeError(f"Public export network error for {presentation_id}: {e}") from e

    if not data or len(data) < 1024 or not data.startswith(b"PK"):
        raise RuntimeError(
            f"Public export returned non-PPTX content for {presentation_id}. "
            "Ensure the file is shared and downloadable."
        )

    destination.write_bytes(data)
    return destination


def fetch_comments(
    presentation_id: str,
    credentials_path: str | Path | None = None,
) -> list[SlideComment]:
    """
    Fetch all comments from a Google Slides presentation.
    
    Comments are fetched via the Drive API (not Slides API) because
    that's where Google stores document comments.
    
    Args:
        presentation_id: The Google Slides presentation ID
        credentials_path: Path to OAuth credentials file
    
    Returns:
        List of SlideComment objects
    """
    if not GOOGLE_API_AVAILABLE:
        print("Google API libraries not installed.")
        return []
    
    creds = get_credentials(credentials_path)
    if not creds:
        return []
    
    comments_list = []
    
    try:
        # Fetch comments (handle pagination)
        drive_service = build('drive', 'v3', credentials=creds)
        comments = []
        page_token = None
        
        while True:
            results = drive_service.comments().list(
                fileId=presentation_id,
                fields="nextPageToken,comments(id,content,author,createdTime,anchor,replies)",
                pageToken=page_token,
                pageSize=100  # Increase page size
            ).execute()
            
            comments.extend(results.get('comments', []))
            page_token = results.get('nextPageToken')
            
            if not page_token:
                break
        
        # Also build Slides service to get slide info
        slides_service = build('slides', 'v1', credentials=creds)
        presentation = slides_service.presentations().get(
            presentationId=presentation_id
        ).execute()
        
        # Create a mapping of page IDs to slide numbers
        page_to_slide = {}
        for i, slide in enumerate(presentation.get('slides', []), start=1):
            page_to_slide[slide['objectId']] = i
        
        # Process comments
        for comment in comments:
            # Skip deleted or resolved comments
            if comment.get('deleted') or comment.get('resolved'):
                continue
                
            # Try to determine which slide the comment is on
            slide_number = 0
            anchor = comment.get('anchor', '')
            
            # Parse anchor JSON to get page ID
            try:
                if isinstance(anchor, str) and anchor:
                    anchor_data = json.loads(anchor)
                    
                    # Try to get page ID from different anchor formats
                    anchor_page_id = None
                    if 'page' in anchor_data:
                        anchor_page_id = anchor_data['page']
                    elif 'pages' in anchor_data and anchor_data['pages']:
                        anchor_page_id = anchor_data['pages'][0]
                    
                    if anchor_page_id and anchor_page_id in page_to_slide:
                        # Exact match only
                        slide_number = page_to_slide[anchor_page_id]
            except (json.JSONDecodeError, TypeError, KeyError):
                pass
            
            # Fallback: try to find any page ID in the anchor string (only exact ID matches)
            if slide_number == 0:
                for page_id, slide_num in page_to_slide.items():
                    if page_id in str(anchor):
                        slide_number = slide_num
                        break
            
            # Get replies
            replies = []
            for reply in comment.get('replies', []):
                replies.append(reply.get('content', ''))
            
            slide_comment = SlideComment(
                slide_number=slide_number,
                author=comment.get('author', {}).get('displayName', 'Unknown'),
                content=comment.get('content', ''),
                created_time=comment.get('createdTime', ''),
                replies=replies
            )
            comments_list.append(slide_comment)
        
        print(f"Fetched {len(comments_list)} comments from presentation")
        
    except Exception as e:
        print(f"Error fetching comments: {e}")
    
    return comments_list


def get_comments_by_slide(comments: list[SlideComment]) -> dict[int, list[SlideComment]]:
    """Group comments by slide number."""
    by_slide = {}
    for comment in comments:
        slide_num = comment.slide_number
        if slide_num not in by_slide:
            by_slide[slide_num] = []
        by_slide[slide_num].append(comment)
    return by_slide


def test_google_api_connection(credentials_path: str | Path | None = None) -> bool:
    """Test if Google API connection is working."""
    if not GOOGLE_API_AVAILABLE:
        return False
    
    creds = get_credentials(credentials_path)
    if not creds:
        return False
    
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        # Try a simple API call
        drive_service.about().get(fields="user").execute()
        return True
    except Exception as e:
        print(f"Google API test failed: {e}")
        return False


if __name__ == "__main__":
    # Test the module
    print("Testing Google API connection...")
    
    if test_google_api_connection():
        print("✅ Google API connection successful!")
    else:
        print("❌ Google API connection failed.")
        print("Run setup_google_auth.py to configure.")
