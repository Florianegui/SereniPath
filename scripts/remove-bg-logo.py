"""Script pour supprimer le fond noir du logo et garder uniquement la feuille."""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Installation de Pillow...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

def remove_black_background(input_path: str, output_path: str, threshold: int = 30):
    """Rend transparent les pixels noirs ou très sombres."""
    img = Image.open(input_path).convert("RGBA")
    data = img.getdata()
    
    new_data = []
    for item in data:
        r, g, b, a = item
        # Si le pixel est noir ou très sombre (fond), le rendre transparent
        if r <= threshold and g <= threshold and b <= threshold:
            new_data.append((r, g, b, 0))
        else:
            new_data.append(item)
    
    img.putdata(new_data)
    img.save(output_path, "PNG")
    print(f"Logo sauvegardé : {output_path}")

if __name__ == "__main__":
    base = Path(__file__).resolve().parent.parent
    src = base / "client" / "public" / "logo.png"
    dest = base / "client" / "public" / "logo.png"
    
    if not src.exists():
        # Essayer la source depuis assets
        alt_src = Path(__file__).resolve().parent.parent.parent / ".cursor" / "projects" / "c-Users-flori-OneDrive-Bureau-SereniPathh" / "assets" / "c__Users_flori_AppData_Roaming_Cursor_User_workspaceStorage_1f348cfe190c361b577e77b22082e5d0_images_ChatGPT_Image_29_janv._2026__10_47_37-cba1a9ed-697e-4ce0-86f0-1b87631bbd71.png"
        if alt_src.exists():
            src = alt_src
        else:
            print(f"Fichier introuvable : {src}")
            sys.exit(1)
    
    remove_black_background(str(src), str(dest), threshold=40)
