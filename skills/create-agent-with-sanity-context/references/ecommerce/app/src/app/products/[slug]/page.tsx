import Link from 'next/link'
import {notFound} from 'next/navigation'
import type {Metadata} from 'next/types'

import {ProductDetails} from '@/components/product-details'
import {client} from '@/sanity/lib/client'
import {PRODUCT_QUERY} from '@/sanity/queries'

import type {PRODUCT_QUERY_RESULT} from '../../../../sanity.types'

interface Props {
  params: Promise<{slug: string}>
}

// Derive types from the generated query result
type Product = NonNullable<PRODUCT_QUERY_RESULT>
type ProductVariant = NonNullable<Product['variants']>[number]
type VariantColor = NonNullable<ProductVariant['color']>
type VariantSize = NonNullable<NonNullable<ProductVariant['sizes']>[number]>

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {slug} = await params
  const product = await client.fetch(PRODUCT_QUERY, {slug})
  if (!product) return {title: 'Product Not Found'}
  return {
    title: `${product.title} | Store`,
    description: product.shortDescription || `Shop ${product.title}`,
  }
}

export default async function ProductPage({params}: Props) {
  const {slug} = await params
  const product: PRODUCT_QUERY_RESULT = await client.fetch(PRODUCT_QUERY, {slug})

  if (!product) {
    notFound()
  }

  const {title, price, category, shortDescription, features, materials, variants, brand} = product

  // Get unique colors and sizes from variants (types inferred from PRODUCT_QUERY_RESULT)
  const colorMap = new Map<string, VariantColor>()
  const sizeMap = new Map<string, VariantSize>()

  variants?.forEach((v) => {
    if (v.color?._id) colorMap.set(v.color._id, v.color)
    // Each variant now has an array of sizes
    v.sizes?.forEach((size) => {
      if (size._id) sizeMap.set(size._id, size)
    })
  })

  const colors = [...colorMap.values()]
  const sizes = [...sizeMap.values()].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:py-12">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-neutral-500">
        <Link href="/products" className="hover:text-neutral-900">
          Products
        </Link>

        {category && (
          <>
            <span className="mx-2">/</span>

            <span>{category.title}</span>
          </>
        )}
      </nav>

      <ProductDetails
        title={title}
        brand={brand}
        category={category}
        shortDescription={shortDescription}
        price={price}
        features={features}
        materials={materials}
        colors={colors}
        sizes={sizes}
        variants={variants}
      />
    </main>
  )
}
