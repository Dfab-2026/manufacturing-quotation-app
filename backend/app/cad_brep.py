"""Exact STEP/IGES B-Rep measurements using Python OpenCascade (OCP).

The module is intentionally isolated and imported lazily by FastAPI.  PDF and
other drawing flows do not depend on OCP, so a CAD-kernel installation problem
cannot break the rest of the quotation application.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
import math


def _call_static(owner: Any, name: str, *args):
    """Support both classic pythonocc-style and OCP ``*_s`` static methods."""
    method = getattr(owner, f"{name}_s", None) or getattr(owner, name, None)
    if method is None:
        raise AttributeError(f"{owner!r} has no {name} method")
    return method(*args)


def _rounded(value: float, digits: int = 6) -> float:
    return round(float(value), digits)


def _count_explorer(shape, shape_type, TopExp_Explorer) -> int:
    explorer = TopExp_Explorer(shape, shape_type)
    count = 0
    while explorer.More():
        count += 1
        explorer.Next()
    return count


def _unique_numbers(values: list[float], digits: int = 4) -> list[float]:
    return sorted({round(float(v), digits) for v in values if math.isfinite(float(v)) and float(v) > 0})


def _infer_wall_thickness(
    cylinder_radii: list[float],
    torus_pairs: list[tuple[float, float]],
) -> dict[str, Any] | None:
    """Return a conservative wall-thickness candidate from exact analytic faces.

    For elbows, paired toroidal surfaces with the same major radius are the most
    useful signal.  Straight/turned hollow parts can fall back to nearby cylinder
    radii.  The result is always marked inferred/review-required by callers.
    """
    best: tuple[float, str, dict[str, float]] | None = None

    # Elbows/pipes frequently have inner/outer toroidal faces sharing the bend radius.
    for i, (major_a, minor_a) in enumerate(torus_pairs):
        for major_b, minor_b in torus_pairs[i + 1 :]:
            major_tol = max(0.05, max(major_a, major_b) * 0.003)
            if abs(major_a - major_b) > major_tol:
                continue
            thickness = abs(minor_a - minor_b)
            outer_minor = max(minor_a, minor_b)
            if 0.05 < thickness <= max(0.5, outer_minor * 0.35):
                candidate = (
                    thickness,
                    "paired_toroidal_surfaces",
                    {
                        "bend_radius_mm": (major_a + major_b) / 2.0,
                        "outer_minor_radius_mm": outer_minor,
                        "inner_minor_radius_mm": min(minor_a, minor_b),
                    },
                )
                if best is None or candidate[0] < best[0]:
                    best = candidate

    # Conservative fallback for cylindrical hollow geometry.
    radii = _unique_numbers(cylinder_radii, 5)
    for outer_i in range(1, len(radii)):
        outer = radii[outer_i]
        for inner in radii[:outer_i]:
            thickness = outer - inner
            if 0.05 < thickness <= max(0.5, outer * 0.25):
                candidate = (
                    thickness,
                    "paired_cylindrical_surfaces",
                    {
                        "outer_diameter_mm": outer * 2.0,
                        "inner_diameter_mm": inner * 2.0,
                    },
                )
                if best is None or candidate[0] < best[0]:
                    best = candidate

    if best is None:
        return None
    thickness, basis, evidence = best
    return {
        "value_mm": round(thickness, 4),
        "basis": basis,
        "evidence": {k: round(v, 4) for k, v in evidence.items()},
        "confidence": 78 if basis == "paired_toroidal_surfaces" else 66,
    }


def analyze_step_brep(content: bytes, filename: str) -> dict[str, Any]:
    """Read STEP/IGES bytes with OCCT and return exact engineering measurements."""
    if not content:
        raise ValueError("CAD file is empty.")

    suffix = Path(filename).suffix.lower()
    if suffix not in {".step", ".stp", ".iges", ".igs"}:
        raise ValueError(f"Python B-Rep analyzer does not support {suffix or 'this format'}.")

    try:
        from OCP.Bnd import Bnd_Box
        from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
        from OCP.BRepBndLib import BRepBndLib
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps
        from OCP.GeomAbs import (
            GeomAbs_Circle,
            GeomAbs_Cone,
            GeomAbs_Cylinder,
            GeomAbs_Plane,
            GeomAbs_Sphere,
            GeomAbs_Torus,
        )
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.IGESControl import IGESControl_Reader
        from OCP.STEPControl import STEPControl_Reader
        from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID, TopAbs_REVERSED
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopoDS import TopoDS
    except Exception as exc:  # pragma: no cover - depends on optional binary wheel
        raise RuntimeError(
            "Python OpenCascade is not installed. Install cadquery-ocp-novtk in the backend virtual environment."
        ) from exc

    with NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        handle.write(content)
        temp_path = handle.name

    try:
        reader = IGESControl_Reader() if suffix in {".iges", ".igs"} else STEPControl_Reader()
        status = reader.ReadFile(temp_path)
        if status != IFSelect_RetDone:
            raise ValueError("OpenCascade could not read the CAD file.")
        transferred = reader.TransferRoots()
        if not transferred:
            raise ValueError("OpenCascade found no transferable CAD roots.")
        shape = reader.OneShape()
        if shape.IsNull():
            raise ValueError("OpenCascade produced an empty CAD shape.")

        bbox = Bnd_Box()
        # Add() may bound the *supporting* infinite/extended analytic surface
        # rather than its trimmed STEP face (e.g. Ø165 flange measured as
        # 182 mm). AddOptimal() computes the actual trimmed-shape limits.
        _call_static(BRepBndLib, "AddOptimal", shape, bbox, False, False)
        # Do not use Bnd_Box.Get()/Limits() here. Some OCP wheels expose
        # Limits() with a return-value binding that pybind cannot convert,
        # which raises at runtime even though the box itself is valid.
        # CornerMin/CornerMax are the binding-safe path used by CadQuery.
        min_point = bbox.CornerMin()
        max_point = bbox.CornerMax()
        xmin, ymin, zmin = (float(v) for v in min_point.Coord())
        xmax, ymax, zmax = (float(v) for v in max_point.Coord())
        dx, dy, dz = max(0.0, xmax - xmin), max(0.0, ymax - ymin), max(0.0, zmax - zmin)

        volume_props = GProp_GProps()
        _call_static(BRepGProp, "VolumeProperties", shape, volume_props)
        volume = max(0.0, float(volume_props.Mass()))

        surface_props = GProp_GProps()
        _call_static(BRepGProp, "SurfaceProperties", shape, surface_props)
        surface_area = max(0.0, float(surface_props.Mass()))

        face_counts: Counter[str] = Counter()
        cylinder_radii: list[float] = []
        cylinder_axes: list[dict[str, Any]] = []
        torus_pairs: list[tuple[float, float]] = []
        torus_points = []
        geometry_locations = []
        bounds_min=[xmin,ymin,zmin]; bounds_max=[xmax,ymax,zmax]
        midpoint=[(a+b)/2 for a,b in zip(bounds_min,bounds_max)]
        for i,(label,val) in enumerate(zip(('Overall X','Overall Y','Overall Z'),(dx,dy,dz))):
            if val<=0:continue
            p0=midpoint.copy();p1=midpoint.copy();p0[i]=bounds_min[i];p1[i]=bounds_max[i]
            geometry_locations.append({'label':label,'value_mm':round(val,4),'points':[p0,p1],'kind':'extent','basis':'Exact B-Rep bounding extent (not a printed dimension)'})
        def surface_point(adaptor):
            try:
                u=(adaptor.FirstUParameter()+adaptor.LastUParameter())/2
                v=(adaptor.FirstVParameter()+adaptor.LastVParameter())/2
                xyz=[float(x) for x in adaptor.Value(u,v).Coord()]
                return xyz if all(math.isfinite(x) for x in xyz) else None
            except Exception:return None
        def add_location(label,value,points,kind='geometry',basis='Exact OCCT geometric source'):
            clean=[]
            for point in points:
                if point and len(point)==3 and all(math.isfinite(float(x)) for x in point):
                    rounded=[round(float(x),6) for x in point]
                    if rounded not in clean:clean.append(rounded)
            if clean and value>0 and math.isfinite(value):
                geometry_locations.append({'label':label,'value_mm':round(value,4),'points':clean[:32],'kind':kind,'basis':basis})
        cones: list[dict[str, float]] = []
        sphere_radii: list[float] = []

        face_explorer = TopExp_Explorer(shape, TopAbs_FACE)
        while face_explorer.More():
            face = _call_static(TopoDS, "Face", face_explorer.Current())
            adaptor = BRepAdaptor_Surface(face, True)
            surface_type = adaptor.GetType()
            if surface_type == GeomAbs_Cylinder:
                face_counts["cylindrical_surfaces"] += 1
                cylinder = adaptor.Cylinder()
                radius = float(cylinder.Radius())
                cylinder_radii.append(radius)
                try:
                    axis = cylinder.Axis()
                    px, py, pz = (float(v) for v in axis.Location().Coord())
                    dx_axis, dy_axis, dz_axis = (float(v) for v in axis.Direction().Coord())
                    norm = math.sqrt(dx_axis * dx_axis + dy_axis * dy_axis + dz_axis * dz_axis) or 1.0
                    direction = [dx_axis / norm, dy_axis / norm, dz_axis / norm]
                    # Canonicalize direction so +axis/-axis represent one line.
                    for component in direction:
                        if abs(component) > 1e-9:
                            if component < 0:
                                direction = [-v for v in direction]
                            break
                    dot = px * direction[0] + py * direction[1] + pz * direction[2]
                    closest = [
                        px - dot * direction[0],
                        py - dot * direction[1],
                        pz - dot * direction[2],
                    ]
                    cylinder_axes.append({
                        "radius_mm": radius,
                        "diameter_mm": radius * 2.0,
                        "direction": direction,
                        "axis_point_mm": closest,
                        "surface_point_mm": surface_point(adaptor),
                        # Internal cylindrical faces (holes/bores) are normally
                        # reversed relative to the owning solid. This prevents
                        # exterior rounds/bosses from being counted as holes.
                        "internal": face.Orientation() == TopAbs_REVERSED,
                    })
                except Exception:
                    pass
            elif surface_type == GeomAbs_Torus:
                face_counts["toroidal_surfaces"] += 1
                torus = adaptor.Torus()
                torus_pairs.append((float(torus.MajorRadius()), float(torus.MinorRadius())))
                torus_points.append((float(torus.MajorRadius()),float(torus.MinorRadius()),surface_point(adaptor)))
            elif surface_type == GeomAbs_Cone:
                face_counts["conical_surfaces"] += 1
                cone = adaptor.Cone()
                cones.append({
                    "radius_mm": float(cone.RefRadius()),
                    "semi_angle_deg": math.degrees(float(cone.SemiAngle())),
                })
            elif surface_type == GeomAbs_Plane:
                face_counts["planes"] += 1
            elif surface_type == GeomAbs_Sphere:
                face_counts["spherical_surfaces"] += 1
                sphere_radii.append(float(adaptor.Sphere().Radius()))
            else:
                face_counts["other_surfaces"] += 1
            face_explorer.Next()

        circle_radii: list[float] = []
        edge_explorer = TopExp_Explorer(shape, TopAbs_EDGE)
        while edge_explorer.More():
            edge = _call_static(TopoDS, "Edge", edge_explorer.Current())
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_Circle:
                radius=float(curve.Circle().Radius())
                circle_radii.append(radius)
                try:
                    point=list(curve.Value((curve.FirstParameter()+curve.LastParameter())/2).Coord())
                    add_location(f'Circular Edge Ø{radius*2:g}',radius*2,[point],basis='Measured circular B-Rep edge')
                except Exception:pass
            edge_explorer.Next()


        # Physical-feature recognition. A STEP exporter may split one physical
        # hole into many faces and may also emit circular boundary edges on both
        # ends. Count one feature per *internal cylinder axis*, independent of
        # how many faces/edges describe it. Counterbores on the same axis remain
        # one physical hole with secondary diameters rather than extra holes.
        hole_features: list[dict[str, Any]] = []
        envelope = [dx, dy, dz]
        order = sorted(range(3), key=lambda i: envelope[i], reverse=True)
        primary = None
        if len(order) == 3 and envelope[order[0]] > 0 and envelope[order[1]] > 0 and envelope[order[0]] >= envelope[order[1]] * 1.35:
            primary = [0.0, 0.0, 0.0]
            primary[order[0]] = 1.0

        max_envelope = max(envelope) if envelope else 0.0
        axis_groups: dict[tuple, dict[str, Any]] = {}
        for row in cylinder_axes:
            if not row.get("internal"):
                continue
            direction = [float(v) for v in row["direction"]]
            diameter = float(row["diameter_mm"])
            if diameter <= 0:
                continue

            # On shafts/tubes, the longitudinal internal cylinder is the bore,
            # not a drilled side hole. Keep it for ID/wall data but exclude it
            # from the hole quantity.
            if primary is not None:
                parallel = abs(sum(direction[i] * primary[i] for i in range(3)))
                if parallel >= 0.94:
                    continue

            # Reject impossible feature diameters spanning essentially the whole
            # part envelope. This removes large curved shell faces misread as holes.
            if max_envelope > 0 and diameter >= max_envelope * 0.95:
                continue

            axis_point = [float(v) for v in row["axis_point_mm"]]
            axis_key = (
                *(round(v, 4) for v in direction),
                *(round(v, 2) for v in axis_point),
            )
            group = axis_groups.setdefault(axis_key, {
                "direction": direction,
                "axis_point_mm": axis_point,
                "diameters": [],
                "points": [],
            })
            group["diameters"].append(diameter)
            if row.get('surface_point_mm'):group['points'].append((diameter,row['surface_point_mm']))

        # One row per physical axis. Group identical primary diameters afterwards
        # so two real Ø10 holes become quantity=2, not 4/8 face occurrences.
        physical_axes: list[dict[str, Any]] = []
        for group in axis_groups.values():
            diameters = _unique_numbers(group["diameters"], 4)
            if not diameters:
                continue
            physical_axes.append({
                "diameter_mm": min(diameters),
                "secondary_diameters_mm": diameters[1:],
                "direction": group["direction"],
                "axis_point_mm": group["axis_point_mm"],
                "points": [point for dia,point in group['points'] if abs(dia-min(diameters))<.005],
            })

        grouped_holes: dict[float, list[dict[str, Any]]] = {}
        for row in physical_axes:
            grouped_holes.setdefault(round(float(row["diameter_mm"]), 3), []).append(row)
        for diameter, rows_for_dia in sorted(grouped_holes.items()):
            secondary = sorted({
                round(float(v), 4)
                for row in rows_for_dia
                for v in row.get("secondary_diameters_mm", [])
                if float(v) > diameter
            })
            hole_features.append({
                "type": "Hole",
                "diameter_mm": diameter,
                "quantity": len(rows_for_dia),
                "through": None,
                "confidence": 94,
                "review_required": False,
                "secondary_diameters_mm": secondary,
                "basis": "Distinct internal OCCT cylindrical axes; split faces and circular edges deduplicated",
            })

        # Bolt PCD is an arrangement of actual cylindrical axes, not a count
        # of circular faces. A symmetric >=4-hole pattern has parallel axes
        # and equal radial distance from their centroid in the normal plane.
        bolt_circle_patterns: list[dict[str, Any]] = []
        for hole_dia, hole_axes in sorted(grouped_holes.items()):
            if len(hole_axes) < 4:
                continue
            axis = hole_axes[0]["direction"]
            if any(abs(sum(a*b for a,b in zip(axis, row["direction"]))) < .998
                   for row in hole_axes):
                continue
            centers = [row["axis_point_mm"] for row in hole_axes]
            centroid = [sum(row[i] for row in centers)/len(centers) for i in range(3)]
            radii = []
            for location in centers:
                disp = [location[i]-centroid[i] for i in range(3)]
                along = sum(disp[i]*axis[i] for i in range(3))
                radii.append(math.sqrt(sum((disp[i]-along*axis[i])**2 for i in range(3))))
            if min(radii) <= .1:
                continue
            mean_radius = sum(radii)/len(radii)
            if max(abs(radius-mean_radius) for radius in radii) > max(.08, mean_radius*.005):
                continue
            pcd = round(mean_radius*2, 4)
            bolt_circle_patterns.append({
                "diameter_mm": round(hole_dia, 4),
                "quantity": len(hole_axes),
                "pcd_mm": pcd,
                "confidence": 90,
                "review_required": True,
                "basis": "Parallel internal hole axes equidistant from a common centroid",
            })
            add_location(f"Bolt PCD Ø{pcd:g}", pcd, centers,
                         kind="calculation", basis="Symmetric internal cylinder axis pattern; review required")

        for dia,rows_for_dia in sorted(grouped_holes.items()):
            points=[pt for row in rows_for_dia for pt in row['points']]
            add_location(f'Hole Ø{dia:g}',dia,points,basis='Measured internal cylindrical hole face(s)')
            add_location('Hole diameter',dia,points,basis='Measured internal cylindrical hole face(s)')
        # Identify semantic primary OD/ID only for elongated rotational parts.
        primary_outer_diameters: list[float] = []
        primary_inner_diameters: list[float] = []
        if primary is not None:
            for row in cylinder_axes:
                direction = row["direction"]
                parallel = abs(sum(float(direction[i]) * primary[i] for i in range(3)))
                if parallel < 0.94:
                    continue
                if row.get("internal"):
                    primary_inner_diameters.append(float(row["diameter_mm"]))
                else:
                    primary_outer_diameters.append(float(row["diameter_mm"]))

        cylinder_diameters = _unique_numbers([r * 2.0 for r in cylinder_radii])
        circle_diameters = _unique_numbers([r * 2.0 for r in circle_radii])
        torus_rows = [
            {"major_radius_mm": _rounded(major, 4), "minor_radius_mm": _rounded(minor, 4)}
            for major, minor in sorted({(round(a, 5), round(b, 5)) for a, b in torus_pairs})
        ]

        dimensions: list[dict[str, Any]] = []
        for label, value in (("Overall X", dx), ("Overall Y", dy), ("Overall Z", dz)):
            if value > 0:
                dimensions.append({
                    "label": label,
                    "value_mm": _rounded(value, 4),
                    "quantity": 1,
                    "kind": "overall",
                    "confidence": 100,
                    "review_required": False,
                    "basis": "Exact OCCT B-Rep bounding box",
                })

        for pattern in bolt_circle_patterns:
            dimensions.append({
                "label": f"Bolt PCD Ø{pattern['pcd_mm']:g} ({pattern['quantity']} x Ø{pattern['diameter_mm']:g})",
                "value_mm": pattern["pcd_mm"],
                "quantity": 1,
                "kind": "bolt_pattern_pcd",
                "confidence": pattern["confidence"],
                "review_required": True,
                "basis": pattern["basis"],
            })

        outer_values = _unique_numbers(primary_outer_diameters)
        inner_values = _unique_numbers(primary_inner_diameters)
        if outer_values:
            od = max(outer_values)
            dimensions.append({
                "label": "Primary Outside Diameter",
                "value_mm": od,
                "quantity": 1,
                "kind": "outside_diameter",
                "confidence": 99,
                "review_required": False,
                "basis": "Largest external cylinder on the dominant part axis",
            })
        if inner_values:
            id_value = max(v for v in inner_values if not outer_values or v < max(outer_values)) if any((not outer_values or v < max(outer_values)) for v in inner_values) else max(inner_values)
            dimensions.append({
                "label": "Primary Inside Diameter",
                "value_mm": id_value,
                "quantity": 1,
                "kind": "inside_diameter",
                "confidence": 99,
                "review_required": False,
                "basis": "Internal cylinder on the dominant part axis",
            })

        for hole in hole_features:
            dimensions.append({
                "label": f"Hole Ø{float(hole['diameter_mm']):g}",
                "value_mm": float(hole["diameter_mm"]),
                "quantity": int(hole.get("quantity") or 1),
                "kind": "hole_diameter",
                "confidence": int(hole.get("confidence") or 94),
                "review_required": bool(hole.get("review_required", False)),
                "basis": str(hole.get("basis") or "Verified internal cylindrical axis"),
            })
        for torus in torus_rows[:30]:
            dimensions.extend([
                {
                    "label": "Bend / Torus Major Radius",
                    "value_mm": torus["major_radius_mm"],
                    "quantity": 1,
                    "kind": "torus_major_radius",
                    "confidence": 98,
                    "review_required": True,
                    "basis": "Exact OCCT toroidal surface major radius",
                },
                {
                    "label": "Bend / Torus Minor Radius",
                    "value_mm": torus["minor_radius_mm"],
                    "quantity": 1,
                    "kind": "torus_minor_radius",
                    "confidence": 98,
                    "review_required": True,
                    "basis": "Exact OCCT toroidal surface minor radius",
                },
            ])

        for label,diameters,internal in [('Primary Outside Diameter',outer_values,False),('Primary Inside Diameter',inner_values,True)]:
            if not diameters or primary is None:continue
            value=max(diameters)
            if internal and outer_values:
                eligible=[v for v in diameters if v<max(outer_values)]
                if eligible:value=max(eligible)
            pts=[row.get('surface_point_mm') for row in cylinder_axes if row.get('internal')==internal and abs(row['diameter_mm']-value)<.005 and abs(sum(row['direction'][i]*primary[i] for i in range(3)))>=.94]
            add_location(label,value,pts,basis='Dominant-axis measured cylindrical face(s)')
        for major,minor,point in torus_points:
            add_location('Bend / Torus Major Radius',major,[point],basis='Measured toroidal surface')
            add_location('Bend / Torus Minor Radius',minor,[point],basis='Measured toroidal surface')
        # Measured concentric internal/external cylinders, not two arbitrary radii.
        coaxial_pairs=[]
        for outer in cylinder_axes:
            if outer['internal']:continue
            for inner in cylinder_axes:
                if not inner['internal']:continue
                if abs(sum(a*b for a,b in zip(outer['direction'],inner['direction'])))<.999:continue
                if math.dist(outer['axis_point_mm'],inner['axis_point_mm'])>.05:continue
                thickness=(outer['diameter_mm']-inner['diameter_mm'])/2
                if thickness>0 and thickness<=outer['diameter_mm']/2:coaxial_pairs.append((thickness,outer,inner))
        distinct={round(row[0],4) for row in coaxial_pairs}
        wall_thickness = _infer_wall_thickness([],torus_pairs)
        if len(distinct)==1:
            thickness,outer,inner=coaxial_pairs[0]
            wall_thickness={'value_mm':round(thickness,4),'basis':'paired_coaxial_internal_external_faces','evidence':{'outer_diameter_mm':outer['diameter_mm'],'inner_diameter_mm':inner['diameter_mm']},'confidence':90}
            add_location('Thickness',thickness,[outer.get('surface_point_mm'),inner.get('surface_point_mm')],kind='calculation',basis='Concentric internal/external cylindrical faces: (OD − ID)/2')
        elif wall_thickness and wall_thickness.get('basis')=='paired_toroidal_surfaces':
            evidence=wall_thickness['evidence']
            pts=[pt for maj,mi,pt in torus_points if abs(maj-evidence['bend_radius_mm'])<.1 and any(abs(mi-evidence[k])<.01 for k in ('outer_minor_radius_mm','inner_minor_radius_mm'))]
            add_location('Thickness',wall_thickness['value_mm'],pts,kind='calculation',basis='Paired toroidal surface radii; estimated wall section')
        # An assembly needs one verifiable BOM placeholder per physical solid.
        # The STEP file does not necessarily provide part names or material for
        # each solid; keep those unknown instead of creating fabricated labels.
        solid_components: list[dict[str, Any]] = []
        solids = TopExp_Explorer(shape, TopAbs_SOLID)
        while solids.More() and len(solid_components) < 100:
            solid = _call_static(TopoDS, "Solid", solids.Current())
            solid_bbox = Bnd_Box()
            _call_static(BRepBndLib, "AddOptimal", solid, solid_bbox, False, False)
            smin = solid_bbox.CornerMin().Coord()
            smax = solid_bbox.CornerMax().Coord()
            mass_properties = GProp_GProps()
            _call_static(BRepGProp, "VolumeProperties", solid, mass_properties)
            solid_components.append({
                "solid_index": len(solid_components) + 1,
                "volume_mm3": _rounded(max(0.0, float(mass_properties.Mass())), 6),
                "dimensions_mm": {axis: _rounded(max(0.0, b-a), 4)
                                  for axis, a, b in zip(("x", "y", "z"), smin, smax)},
            })
            solids.Next()
        solid_count = _count_explorer(shape, TopAbs_SOLID, TopExp_Explorer)
        face_count = _count_explorer(shape, TopAbs_FACE, TopExp_Explorer)
        edge_count = _count_explorer(shape, TopAbs_EDGE, TopExp_Explorer)

        positive_dims = sorted(v for v in (dx, dy, dz) if v > 0)
        if positive_dims and positive_dims[0] <= positive_dims[-1] * 0.12:
            shape_hint = "plate_like"
        elif face_counts["cylindrical_surfaces"] or face_counts["toroidal_surfaces"]:
            shape_hint = "rotational_like"
        elif positive_dims:
            shape_hint = "prismatic_like"
        else:
            shape_hint = "unknown"

        if shape_hint == 'plate_like' and solid_count<=1:
            smallest=min((dx,dy,dz))
            if smallest>0:
                extent=next((r for r in geometry_locations if r['kind']=='extent' and abs(r['value_mm']-smallest)<.005),None)
                if extent:geometry_locations.append({**extent,'label':'Thickness','kind':'calculation','basis':'Estimated thickness from minimum flat-plate bounding dimension'})
        return {
            "parser": "python_ocp",
            "parser_status": "parsed",
            "dimensions_mm": {"x": _rounded(dx, 4), "y": _rounded(dy, 4), "z": _rounded(dz, 4)},
            "volume_mm3": _rounded(volume, 6),
            "surface_area_mm2": _rounded(surface_area, 6),
            "solid_count": max(1, solid_count),
            "solid_components": solid_components,
            "face_count": face_count,
            "edge_count": edge_count,
            "shape_hint": shape_hint,
            "geometry_dimensions": dimensions,
            "geometry_locations": geometry_locations[:500],
            "cylindrical_diameters_mm": cylinder_diameters,
            "circle_diameters_mm": circle_diameters,
            "primary_outer_diameters_mm": _unique_numbers(primary_outer_diameters),
            "primary_inner_diameters_mm": _unique_numbers(primary_inner_diameters),
            "torus_radii_mm": torus_rows,
            "conical_surfaces": [
                {"radius_mm": _rounded(row["radius_mm"], 4), "semi_angle_deg": _rounded(row["semi_angle_deg"], 4)}
                for row in cones[:50]
            ],
            "sphere_radii_mm": _unique_numbers(sphere_radii),
            "entity_counts": dict(face_counts),
            "wall_thickness": wall_thickness,
            "hole_features": hole_features,
            "bolt_circle_patterns": bolt_circle_patterns,
        }
    finally:
        try:
            Path(temp_path).unlink(missing_ok=True)
        except Exception:
            pass
