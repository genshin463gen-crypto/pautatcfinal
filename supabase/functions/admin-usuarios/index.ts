// Función "admin-usuarios": crea, edita y borra usuarios del dashboard.
// Solo la puede usar alguien con rol "admin". Corre en Supabase (Edge Functions).
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = ["admin", "gerente", "usuario"];
const rolValido = (r: unknown) => (ROLES.includes(String(r)) ? String(r) : "usuario");
const DOMINIO = "tcpauta.local"; // los usuarios sin @ se guardan como usuario@tcpauta.local
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Clave de servicio: proyectos viejos usan SUPABASE_SERVICE_ROLE_KEY; los nuevos, SUPABASE_SECRET_KEYS.
    let clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!clave) {
      try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); clave = k.default || Object.values(k)[0] || ""; } catch (_) { /* sin clave */ }
    }
    if (!clave) return json({ error: "La función no encuentra la clave de servicio del proyecto." }, 500);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, clave as string);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return json({ error: "Sesión vencida. Volvé a entrar." }, 401);
    const { data: yo } = await sb.from("perfiles").select("rol,activo").eq("id", user.id).single();
    if (!yo || yo.rol !== "admin" || !yo.activo) return json({ error: "Solo un administrador puede hacer esto." }, 403);

    const b = await req.json();
    if (b.accion === "crear") {
      const usuario = String(b.usuario || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(usuario) && !usuario.includes("@"))
        return json({ error: "Usuario inválido: usá 3 a 30 letras, números, punto o guion." }, 400);
      if (String(b.password || "").length < 8) return json({ error: "La clave debe tener al menos 8 caracteres." }, 400);
      const email = usuario.includes("@") ? usuario : `${usuario}@${DOMINIO}`;
      const { data, error } = await sb.auth.admin.createUser({ email, password: b.password, email_confirm: true });
      if (error) return json({ error: error.message.includes("already") ? "Ese usuario ya existe." : error.message }, 400);
      const { error: e2 } = await sb.from("perfiles").insert({
        id: data.user.id, usuario, nombre: b.nombre || usuario, rol: rolValido(b.rol),
      });
      if (e2) { await sb.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
      return json({ ok: true });
    }

    if (b.accion === "actualizar") {
      if (!b.id) return json({ error: "Falta el usuario." }, 400);
      if (b.id === user.id && ((b.rol !== undefined && b.rol !== "admin") || b.activo === false))
        return json({ error: "No podés quitarte el acceso de administrador a vos mismo." }, 400);
      if (b.password) {
        if (String(b.password).length < 8) return json({ error: "La clave debe tener al menos 8 caracteres." }, 400);
        const { error } = await sb.auth.admin.updateUserById(b.id, { password: b.password });
        if (error) return json({ error: error.message }, 400);
      }
      const cambios: Record<string, unknown> = {};
      if (b.nombre !== undefined) cambios.nombre = b.nombre;
      if (b.rol !== undefined) cambios.rol = rolValido(b.rol);
      if (b.activo !== undefined) cambios.activo = !!b.activo;
      if (Object.keys(cambios).length) {
        const { error } = await sb.from("perfiles").update(cambios).eq("id", b.id);
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    if (b.accion === "borrar") {
      if (b.id === user.id) return json({ error: "No podés borrar tu propio usuario." }, 400);
      const { error } = await sb.auth.admin.deleteUser(b.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
