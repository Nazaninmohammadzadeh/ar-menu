#!/usr/bin/env python3
"""
GLB -> USDZ dönüştürücü (iPhone AR Quick Look için).

Kullanım:
    npm run usdz -- models/yemek.glb            # models/yemek.usdz üretir
    python3 tools/glb2usdz.py girdi.glb [cikti.usdz]

Gerekli paketler (bir kez):
    pip install -r tools/requirements.txt

Not: Girdi, prepare.mjs çıktısı gibi sıkıştırmasız bir GLB olmalı
(Draco/Meshopt sıkıştırmalı GLB'ler okunamaz).
"""
import re
import sys
import shutil
import tempfile
from pathlib import Path

try:
    import numpy as np
    import trimesh
    from PIL import Image
    from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, Vt, UsdUtils
except ImportError as e:  # pragma: no cover
    sys.exit(f"Eksik paket: {e.name}\nKurulum: pip install -r tools/requirements.txt")


def safe_name(name: str, used: set) -> str:
    n = re.sub(r"[^A-Za-z0-9_]", "_", name or "obje")
    if not n or n[0].isdigit():
        n = "m_" + n
    base, i = n, 1
    while n in used:
        i += 1
        n = f"{base}_{i}"
    used.add(n)
    return n


def save_texture(img: Image.Image, folder: Path, stem: str) -> str:
    """PNG (alfa varsa) veya JPEG olarak kaydeder, paket içi göreli yolu döner."""
    has_alpha = img.mode in ("RGBA", "LA") and np.asarray(img.convert("RGBA"))[..., 3].min() < 255
    if has_alpha:
        path = folder / f"{stem}.png"
        img.convert("RGBA").save(path)
    else:
        path = folder / f"{stem}.jpg"
        img.convert("RGB").save(path, quality=90)
    return f"textures/{path.name}"


def build_material(stage, mat_path, material, tex_dir: Path, tex_cache: dict):
    """trimesh PBRMaterial -> UsdPreviewSurface."""
    usd_mat = UsdShade.Material.Define(stage, mat_path)
    shader = UsdShade.Shader.Define(stage, f"{mat_path}/PBR")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("useSpecularWorkflow", Sdf.ValueTypeNames.Int).Set(0)
    usd_mat.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")

    def factor(attr, default):
        v = getattr(material, attr, None)
        return default if v is None else v

    base = np.array(factor("baseColorFactor", [255, 255, 255, 255]), dtype=float)
    if base.max() > 1.0:
        base = base / 255.0
    base = np.pad(base, (0, 4 - len(base)), constant_values=1.0) if len(base) < 4 else base
    metallic = float(factor("metallicFactor", 0.0))
    roughness = float(factor("roughnessFactor", 0.8))

    st_reader = None

    def texture_node(img, key, color_space):
        nonlocal st_reader
        if st_reader is None:
            st_reader = UsdShade.Shader.Define(stage, f"{mat_path}/stReader")
            st_reader.CreateIdAttr("UsdPrimvarReader_float2")
            st_reader.CreateInput("varname", Sdf.ValueTypeNames.String).Set("st")
        if id(img) not in tex_cache:
            tex_cache[id(img)] = save_texture(img, tex_dir, f"{mat_path.name}_{key}")
        tex = UsdShade.Shader.Define(stage, f"{mat_path}/{key}Tex")
        tex.CreateIdAttr("UsdUVTexture")
        tex.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(tex_cache[id(img)])
        tex.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(
            st_reader.ConnectableAPI(), "result")
        tex.CreateInput("wrapS", Sdf.ValueTypeNames.Token).Set("repeat")
        tex.CreateInput("wrapT", Sdf.ValueTypeNames.Token).Set("repeat")
        tex.CreateInput("sourceColorSpace", Sdf.ValueTypeNames.Token).Set(color_space)
        return tex

    # Renk (baseColor)
    img = getattr(material, "baseColorTexture", None)
    if img is not None:
        tex = texture_node(img, "diffuse", "sRGB")
        tex.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*base.tolist()))
        tex.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
        shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(
            tex.ConnectableAPI(), "rgb")
    else:
        shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*base[:3]))

    # Pürüzlülük / metalik (glTF: G = roughness, B = metallic)
    mr = getattr(material, "metallicRoughnessTexture", None)
    if mr is not None:
        tex = texture_node(mr, "orm", "raw")
        tex.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(
            Gf.Vec4f(1.0, roughness, metallic, 1.0))
        tex.CreateOutput("g", Sdf.ValueTypeNames.Float)
        tex.CreateOutput("b", Sdf.ValueTypeNames.Float)
        shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).ConnectToSource(
            tex.ConnectableAPI(), "g")
        shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).ConnectToSource(
            tex.ConnectableAPI(), "b")
    else:
        shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(roughness)
        shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metallic)

    # Normal map
    nrm = getattr(material, "normalTexture", None)
    if nrm is not None:
        tex = texture_node(nrm, "normal", "raw")
        tex.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(2, 2, 2, 1))
        tex.CreateInput("bias", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(-1, -1, -1, 0))
        tex.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
        shader.CreateInput("normal", Sdf.ValueTypeNames.Normal3f).ConnectToSource(
            tex.ConnectableAPI(), "rgb")

    # Saydamlık
    if base[3] < 1.0:
        shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(float(base[3]))
    return usd_mat


def material_of(mesh):
    vis = mesh.visual
    if isinstance(vis, trimesh.visual.TextureVisuals) and vis.material is not None:
        mat = vis.material
        if isinstance(mat, trimesh.visual.material.SimpleMaterial):
            mat = mat.to_pbr()
        return mat, vis.uv
    # Vertex renkli modeller: ortalama rengi kullan
    color = trimesh.visual.material.PBRMaterial(name="vertexcolor")
    try:
        color.baseColorFactor = mesh.visual.vertex_colors.mean(axis=0).astype(np.uint8)
    except Exception:
        color.baseColorFactor = [200, 200, 200, 255]
    return color, None


def convert(src: Path, dst: Path):
    scene = trimesh.load(str(src), force="scene", process=False)
    if not scene.geometry:
        sys.exit("Modelde geometri bulunamadı.")

    work = Path(tempfile.mkdtemp(prefix="usdz_"))
    tex_dir = work / "textures"
    tex_dir.mkdir()
    usdc = work / "model.usdc"

    stage = Usd.Stage.CreateNew(str(usdc))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)       # glTF gibi Y yukarı
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)             # 1 birim = 1 metre (gerçek boyut)
    root = UsdGeom.Xform.Define(stage, "/Root")
    stage.SetDefaultPrim(root.GetPrim())
    UsdGeom.Scope.Define(stage, "/Root/Materials")

    used_names, mat_cache, tex_cache = set(), {}, {}
    tris = 0
    for node in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node]
        mesh = scene.geometry[geom_name]
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
            continue
        mesh = mesh.copy()
        mesh.apply_transform(transform)
        tris += len(mesh.faces)

        material, uv = material_of(mesh)
        mkey = id(material)
        if mkey not in mat_cache:
            mpath = Sdf.Path(f"/Root/Materials/{safe_name(getattr(material, 'name', None) or 'mat', used_names)}")
            mat_cache[mkey] = build_material(stage, mpath, material, tex_dir, tex_cache)

        prim = UsdGeom.Mesh.Define(stage, f"/Root/{safe_name(str(node), used_names)}")
        prim.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
        prim.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(mesh.vertices.astype(np.float32)))
        prim.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(mesh.faces), 3, dtype=np.int32)))
        prim.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(mesh.faces.astype(np.int32).ravel()))
        prim.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(mesh.vertex_normals.astype(np.float32)))
        prim.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
        prim.CreateExtentAttr(Vt.Vec3fArray([Gf.Vec3f(*mesh.bounds[0]), Gf.Vec3f(*mesh.bounds[1])]))
        if uv is not None and len(uv) == len(mesh.vertices):
            # trimesh UV'leri zaten sol-alt orijinli (USD ile aynı)
            st = UsdGeom.PrimvarsAPI(prim).CreatePrimvar(
                "st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
            st.Set(Vt.Vec2fArray.FromNumpy(np.asarray(uv, dtype=np.float32)))
        UsdShade.MaterialBindingAPI.Apply(prim.GetPrim()).Bind(mat_cache[mkey])

    stage.GetRootLayer().Save()
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    ok = UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(usdc)), str(dst))  # tek katman: ARKit ile uyumlu
    shutil.rmtree(work, ignore_errors=True)
    if not ok:
        sys.exit("USDZ paketi oluşturulamadı.")

    # USD doğrulayıcılarıyla kontrol (usdchecker'ın yaptığı kontroller)
    problems = []
    try:
        from pxr import UsdValidation
        validators = UsdValidation.ValidationRegistry().GetOrLoadAllValidators()
        errors = UsdValidation.ValidationContext(validators).Validate(Usd.Stage.Open(str(dst)))
        problems = [e.GetMessage() for e in errors]
    except Exception as e:  # eski USD sürümleri
        problems = [] if "UsdValidation" in str(e) else [str(e)]
    size = dst.stat().st_size / 1024 / 1024
    print(f"\n✔ Hazır: {dst}  ({size:.2f} MB, {tris:,} üçgen)".replace(f"{tris:,}", f"{tris:,}".replace(",", ".")))
    if problems:
        print("⚠ Uyumluluk uyarıları:")
        for p in problems:
            print("  -", p)
    else:
        print("  USD/USDZ doğrulama kontrolleri: geçti")
    print("\nSıradaki adım: menu.json içinde bu yemeğin \"modelIos\" alanına bu dosyayı yaz.\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    if not src.exists():
        sys.exit(f"Dosya bulunamadı: {src}")
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".usdz")
    convert(src, dst)
