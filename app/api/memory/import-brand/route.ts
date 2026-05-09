import { importBrand } from "@/lib/brand-importer";

export async function POST() {
  const result = importBrand();
  return Response.json(result);
}
