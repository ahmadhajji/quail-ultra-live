#!/usr/bin/env python3
"""
Google API Setup Script

Interactive script to guide users through setting up Google API access
for fetching comments from Google Slides.

This is OPTIONAL - the main functionality works without it.
"""

import os
import sys
import webbrowser
from pathlib import Path

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm
    from rich.markdown import Markdown
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

console = Console() if RICH_AVAILABLE else None


def print_step(step_num: int, title: str, content: str):
    """Print a setup step."""
    if console:
        console.print(f"\n[bold cyan]Step {step_num}:[/bold cyan] [bold]{title}[/bold]")
        console.print(Panel(content, border_style="dim"))
    else:
        print(f"\n=== Step {step_num}: {title} ===")
        print(content)


def main():
    """Run the Google API setup wizard."""
    if console:
        console.print(Panel.fit(
            "[bold blue]Google API Setup[/bold blue]\n"
            "[dim]Enable fetching comments from Google Slides[/dim]",
            border_style="blue"
        ))
    else:
        print("=" * 50)
        print("Google API Setup")
        print("Enable fetching comments from Google Slides")
        print("=" * 50)
    
    console.print("\n[yellow]Note: This is OPTIONAL. Skip if you don't need comments.[/yellow]")
    console.print("[dim]The main extraction works without Google API access.[/dim]\n")
    
    if not Confirm.ask("Do you want to set up Google API access?", default=True):
        console.print("[dim]Skipping Google API setup.[/dim]")
        return
    
    # Step 1: Create Google Cloud Project
    print_step(1, "Create Google Cloud Project", """
1. Go to Google Cloud Console: https://console.cloud.google.com/
2. Click "Select a project" → "New Project"
3. Name it something like "QBank Parser"
4. Click "Create"
""")
    
    if Confirm.ask("Open Google Cloud Console in browser?", default=True):
        webbrowser.open("https://console.cloud.google.com/")
    
    input("\nPress Enter when you have created the project...")
    
    # Step 2: Enable APIs
    print_step(2, "Enable Required APIs", """
1. In Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Google Drive API" and enable it
3. Search for "Google Slides API" and enable it
""")
    
    if Confirm.ask("Open API Library in browser?", default=True):
        webbrowser.open("https://console.cloud.google.com/apis/library")
    
    input("\nPress Enter when you have enabled both APIs...")
    
    # Step 3: Create OAuth Credentials
    print_step(3, "Create OAuth Credentials", """
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External (or Internal if using Workspace)
   - App name: "QBank Parser"
   - User support email: Your email
   - Add your email to test users
4. For Application type, choose "Desktop app"
5. Name it "QBank Parser Desktop"
6. Click "Create"
7. Download the JSON file (click the download button)
8. Rename it to "credentials.json"
9. Move it to this folder: {cwd}
""".format(cwd=Path.cwd()))
    
    if Confirm.ask("Open Credentials page in browser?", default=True):
        webbrowser.open("https://console.cloud.google.com/apis/credentials")
    
    # Wait for credentials file
    creds_path = Path("credentials.json")
    
    console.print("\n[bold]Waiting for credentials.json file...[/bold]")
    console.print(f"[dim]Expected location: {creds_path.absolute()}[/dim]")
    
    while True:
        if creds_path.exists():
            console.print("[green]✅ credentials.json found![/green]")
            break
        
        if not Confirm.ask("credentials.json not found. Check again?", default=True):
            console.print("[yellow]Setup incomplete. You can run this script again later.[/yellow]")
            return
    
    # Step 4: First authentication
    print_step(4, "Authenticate", """
Now we'll authenticate with Google to get access to your slides.
A browser window will open for you to sign in.
""")
    
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
        
        SCOPES = [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/presentations.readonly'
        ]
        
        flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
        creds = flow.run_local_server(port=0)
        
        # Save the token
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
        
        console.print("[green]✅ Authentication successful![/green]")
        
        # Test the connection
        console.print("\n[bold]Testing connection...[/bold]")
        drive_service = build('drive', 'v3', credentials=creds)
        about = drive_service.about().get(fields="user").execute()
        user_email = about.get('user', {}).get('emailAddress', 'Unknown')
        
        console.print(f"[green]✅ Connected as: {user_email}[/green]")
        
    except Exception as e:
        console.print(f"[red]❌ Authentication failed: {e}[/red]")
        console.print("[dim]You can try running this script again.[/dim]")
        return
    
    # Step 5: Get Slides ID
    print_step(5, "Configure Slides ID", """
To fetch comments, we need the ID of your Google Slides presentation.
You can find this in the URL:
https://docs.google.com/presentation/d/[THIS_IS_THE_ID]/edit
""")
    
    slides_id = Prompt.ask("Paste your Google Slides presentation ID (or press Enter to skip)")
    
    if slides_id:
        # Update .env file
        env_path = Path(".env")
        env_content = ""
        
        if env_path.exists():
            env_content = env_path.read_text()
        
        if "GOOGLE_SLIDES_ID=" in env_content:
            # Replace existing
            import re
            env_content = re.sub(
                r'GOOGLE_SLIDES_ID=.*',
                f'GOOGLE_SLIDES_ID={slides_id}',
                env_content
            )
        else:
            env_content += f"\nGOOGLE_SLIDES_ID={slides_id}\n"
        
        env_path.write_text(env_content)
        console.print(f"[green]✅ Slides ID saved to .env[/green]")
    
    # Done!
    console.print(Panel.fit(
        "[bold green]✅ Google API Setup Complete![/bold green]\n\n"
        "You can now use [cyan]--with-google-api[/cyan] flag to fetch comments:\n"
        "[dim]python main.py presentation.pptx --with-google-api[/dim]",
        border_style="green"
    ))


if __name__ == "__main__":
    main()
