import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { scrapeHtml, MIRRORS } from '../../stream-indo/route'

export const runtime = 'nodejs'

const extractSlug = (url: string) => url.replace(/\/$/, '').split('/').pop() ?? ''

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ genreId: string }> }
) {
  const { genreId } = await params
  const page = req.nextUrl.searchParams.get('page') ?? '1'

  try {
    const pageUrl = page === '1'
      ? `${MIRRORS[0]}/genres/${genreId}/`
      : `${MIRRORS[0]}/genres/${genreId}/page/${page}/`

    // We fetch and parse the HTML using our exported scrapeHtml helper which races mirrors
    const { $, base } = await scrapeHtml(pageUrl)
    const isNewTheme = base.includes('otakudesu.fit')

    const animeList: any[] = []
    const seenIds = new Set<string>()

    if (isNewTheme) {
      $('.listupd .bsx').each((_, el) => {
        const a = $(el).find('a').first()
        const href = a.attr('href') ?? ''
        if (!href) return

        const animeId = extractSlug(href)
        if (!animeId || seenIds.has(animeId)) return
        seenIds.add(animeId)

        const title = a.attr('title')?.trim() || a.find('.tt h2').text().trim() || a.find('.tt').text().trim()
        const poster = a.find('img').attr('src') ?? ''
        
        // Try to find episode count
        const epText = $(el).find('.limit .ep, .limit .epx, .epx, .ep').text().replace(/ep/i, '').trim()
        const episodes = epText || '?'

        animeList.push({
          animeId,
          title,
          poster,
          episodes,
          releaseDay: '',
          latestReleaseDate: ''
        })
      })
    } else {
      $('.col-anime').each((_, el) => {
        const $el = $(el)
        const $a = $el.find('.col-anime-title a').first()
        const href = $a.attr('href') ?? ''
        if (!href) return

        const animeId = extractSlug(href)
        if (!animeId || seenIds.has(animeId)) return
        seenIds.add(animeId)

        const title = $a.text().trim()
        
        const $img = $el.find('.col-anime-cover img').first()
        const poster = $img.attr('src') || ''

        const epText = $el.find('.col-anime-eps').text().replace(/eps|epsd|ep/i, '').trim()
        const episodes = epText || '?'

        const dateText = $el.find('.col-anime-date').text().trim()
        
        animeList.push({
          animeId,
          title,
          poster,
          episodes,
          releaseDay: '',
          latestReleaseDate: dateText
        })
      })
    }

    console.log('[proxy/genre scraped]', genreId, `Found ${animeList.length} items`)

    // Extract if there is a next page
    const hasNext = $('.pagination .next, .pagenavix .next').length > 0

    return NextResponse.json(
      {
        success: true,
        data: animeList,
        pagination: {
          current: Number(page),
          hasNext,
        }
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (e: any) {
    console.error('[proxy/genre]', genreId, e)
    return NextResponse.json({ success: false, data: [] }, { status: 500 })
  }
}
