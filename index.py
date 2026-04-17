from datasette.app import Datasette
import pathlib

app_dir = pathlib.Path(__file__).parent
ds = Datasette(
    [str(app_dir / "services.db")],
    metadata=str(app_dir / "metadata.json"),
)

async def app(scope, receive, send):
    if not hasattr(app, "_started"):
        await ds.invoke_startup()
        app._started = True
    asgi_app = ds.app()
    await asgi_app(scope, receive, send)
