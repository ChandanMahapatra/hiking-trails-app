import { createReadStream } from 'node:fs'
import { cp, stat } from 'node:fs/promises'
import dns from 'dns'
import { extname, resolve } from 'node:path'
import { defineConfig } from 'vite'

dns.setDefaultResultOrder('verbatim')

const componentAssetCopies = [
  {
    publicPath: '/calcite/assets',
    outputDir: 'calcite/assets',
    sourceDir: resolve(
      process.cwd(),
      'node_modules',
      '@esri',
      'calcite-components',
      'dist',
      'cdn',
      'assets'
    )
  },
  {
    publicPath: '/arcgis/map-components/assets',
    outputDir: 'arcgis/map-components/assets',
    sourceDir: resolve(
      process.cwd(),
      'node_modules',
      '@arcgis',
      'map-components',
      'dist',
      'cdn',
      'assets'
    )
  },
  {
    publicPath: '/arcgis/common-components/assets',
    outputDir: 'arcgis/common-components/assets',
    sourceDir: resolve(
      process.cwd(),
      'node_modules',
      '@arcgis',
      'common-components',
      'dist',
      'cdn',
      'assets'
    )
  }
]

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function getContentType(filePath) {
  return contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function resolveAssetRequest(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0])

  for (const assetCopy of componentAssetCopies) {
    if (!pathname.startsWith(`${assetCopy.publicPath}/`)) {
      continue
    }

    const relativePath = pathname.slice(assetCopy.publicPath.length + 1)
    const filePath = resolve(assetCopy.sourceDir, relativePath)
    if (!filePath.startsWith(assetCopy.sourceDir)) {
      return null
    }

    return filePath
  }

  return null
}

function serveComponentAssetsPlugin() {
  return {
    name: 'serve-component-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const filePath = req.url ? resolveAssetRequest(req.url) : null
        if (!filePath) {
          return next()
        }

        try {
          const fileInfo = await stat(filePath)
          if (!fileInfo.isFile()) {
            return next()
          }

          res.statusCode = 200
          res.setHeader('Content-Type', getContentType(filePath))
          createReadStream(filePath).pipe(res)
        } catch {
          return next()
        }
      })
    }
  }
}

function copyComponentAssetsPlugin() {
  let outDir = resolve(process.cwd(), 'dist')

  return {
    name: 'copy-component-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      await Promise.all(
        componentAssetCopies.map(({ sourceDir, outputDir }) => {
          return cp(sourceDir, resolve(outDir, outputDir), {
            recursive: true,
            force: true
          })
        })
      )
    }
  }
}

export default defineConfig(({ command }) => {
  return {
    plugins: [serveComponentAssetsPlugin(), copyComponentAssetsPlugin()],
    server: {
      port: 3000
    },
    base: command === 'serve' ? '/' : './',
    resolve: {
      dedupe: [
        '@arcgis/common-components',
        '@arcgis/core',
        '@arcgis/lumina',
        '@arcgis/map-components',
        '@arcgis/toolkit',
        '@esri/calcite-components',
        '@lit/reactive-element',
        'lit',
        'lit-element',
        'lit-html'
      ]
    },
    optimizeDeps: {
      include: [
        '@arcgis/common-components',
        '@arcgis/map-components',
        '@esri/calcite-components'
      ]
    }
  }
})
