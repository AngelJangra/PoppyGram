// GET /api/web/products?q=optional_search
// Public endpoint: lists all active store products with photo IDs.
// No admin auth required — for the user-facing web store.
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/db";
import { getProductPhotoMap } from "../../../lib/storeFlow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const q = String(req.query.q || "").trim();
    let products: any[] = [];
    if (q) {
      const needle = q.replace(/[%_\\,()":;!*|&]/g, "").replace(/\s+/g, " ").slice(0, 64);
      const { data, error } = await db
        .from("store_products")
        .select("id,name,description,price,file_name,file_size,created_at")
        .eq("active", true)
        .or(`name.ilike.%${needle}%,description.ilike.%${needle}%,file_name.ilike.%${needle}%`)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      products = data || [];
    } else {
      const { data, error } = await db
        .from("store_products")
        .select("id,name,description,price,file_name,file_size,created_at")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      products = data || [];
    }
    const photoMap = await getProductPhotoMap();
    const result = products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      file_name: p.file_name,
      file_size: Number(p.file_size || 0),
      created_at: p.created_at,
      photo_id: photoMap.get(String(p.id)) || null,
    }));
    return res.status(200).json({ products: result });
  } catch (e: any) {
    console.error("[web/products]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

