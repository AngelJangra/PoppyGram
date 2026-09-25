// GET /api/web/product?id=N
// Public endpoint: single product detail with photo ID.
import type { NextApiRequest, NextApiResponse } from "next";
import { getProduct, getProductPhoto } from "../../../lib/storeFlow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Product id required" });
    }
    const product = await getProduct(id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    const photo_id = await getProductPhoto(id);
    return res.status(200).json({
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        file_name: product.file_name,
        file_size: Number(product.file_size || 0),
        created_at: product.created_at,
        photo_id: photo_id || null,
      },
    });
  } catch (e: any) {
    console.error("[web/product]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

