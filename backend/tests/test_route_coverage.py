"""Fail when a mounted API route has no cell in MATRIX_CELLS.

The matrix is the policy and MATRIX_CELLS its executable form, so a route added
without a cell means an unreviewed permission surface. Fix a failure by adding the
route to docs/AUTHZ_MATRIX.md section 7 and a cell to _matrix_cells.py, never by
widening the exclusions below.
"""

from _matrix_cells import MATRIX_CELLS
from fastapi.routing import APIRoute

# Deliberately outside the matrix, each with a reason.
EXCLUDED_ROUTES = {
    # Development-only Sentry smoke test (mounted only when SENTRY_ENVIRONMENT=development);
    # its admin gate is asserted in test_authorization_inventory.py.
    ("POST", "/api/__sentry-test"),
}
IMPLICIT_METHODS = {"HEAD", "OPTIONS"}


def _mounted_api_routes():
    import main

    routes = set()
    for route in main.app.routes:
        # Framework docs/schema routes (/docs, /redoc, /openapi.json) are not APIRoute;
        # the health check at "/" is outside /api. Production lockdown is tested separately.
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        routes |= {(method, route.path) for method in route.methods - IMPLICIT_METHODS}
    return routes - EXCLUDED_ROUTES


def test_matrix_cells_cover_every_route():
    covered = {(cell.method, cell.path) for cell in MATRIX_CELLS}
    missing = sorted(_mounted_api_routes() - covered)
    assert not missing, f"Routes missing from MATRIX_CELLS: {missing}"


def test_matrix_cells_name_only_mounted_routes():
    stale = sorted({(cell.method, cell.path) for cell in MATRIX_CELLS} - _mounted_api_routes())
    assert not stale, f"MATRIX_CELLS cells for routes that are not mounted: {stale}"


def test_every_route_covers_at_least_two_roles():
    roles_by_route = {}
    for cell in MATRIX_CELLS:
        roles_by_route.setdefault((cell.method, cell.path), set()).add(cell.role)
    thin = sorted(route for route, roles in roles_by_route.items() if len(roles) < 2)
    assert not thin, f"Routes with a single role covered: {thin}"
