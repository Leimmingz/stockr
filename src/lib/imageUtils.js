import { supabase } from './supabase'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 2 * 1024 * 1024   // 2 Mo (limite bucket Supabase)
const MAX_DIMENSION  = 1200               // px max largeur/hauteur
const JPEG_QUALITY   = 0.82

/**
 * Compresse et redimensionne une image côté client via Canvas,
 * puis l'upload dans le bucket Supabase indiqué.
 */
export async function compressAndUpload(file, bucket, path) {
  // Validation type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Format non supporté (jpeg, png, webp uniquement)')
  }

  // Compression via Canvas
  const compressed = await compressImage(file)

  // Validation taille après compression
  if (compressed.size > MAX_SIZE_BYTES) {
    throw new Error(`Image trop lourde après compression (max 2 Mo, actuel: ${(compressed.size/1024/1024).toFixed(1)} Mo)`)
  }

  // Upload
  const ext  = 'jpg'
  const safePath = path.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  const name = `${safePath}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(name, compressed, {
    upsert: true,
    contentType: 'image/jpeg',
  })
  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(name)
  return data.publicUrl
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Calcul dimensions cibles
      let { width, height } = img
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width >= height) {
          height = Math.round(height * MAX_DIMENSION / width)
          width  = MAX_DIMENSION
        } else {
          width  = Math.round(width  * MAX_DIMENSION / height)
          height = MAX_DIMENSION
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Échec compression')); return }
        resolve(new File([blob], 'image.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', JPEG_QUALITY)
    }

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Lecture image impossible")) }
    img.src = url
  })
}
