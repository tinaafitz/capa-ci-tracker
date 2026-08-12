/**
 * PostgREST-compatible REST client.
 *
 * Drop-in replacement for @supabase/supabase-js that speaks PostgREST's
 * native filter/header protocol. On OpenShift, nginx proxies /api/ to
 * the PostgREST service; locally, VITE_API_URL points at PostgREST directly.
 *
 * The builder is thenable — `await supabase.from('x').select('*')` works.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api'
const API_KEY = import.meta.env.VITE_API_KEY || ''

class PostgRESTFilterBuilder {
  constructor(url, { method = 'GET', headers = {}, body = null } = {}) {
    this._url = url
    this._method = method
    this._headers = { ...headers }
    if (API_KEY) {
      this._headers['apikey'] = API_KEY
      this._headers['Authorization'] = `Bearer ${API_KEY}`
    }
    this._body = body
    this._params = new URLSearchParams()
    this._isSingle = false
    this._isMaybeSingle = false
    this._isHead = false
    this._wantCount = false
    this._selectCalled = false
  }

  // ── Filter operators ────────────────────────────────────────────

  eq(column, value) {
    this._params.append(column, `eq.${value}`)
    return this
  }

  neq(column, value) {
    this._params.append(column, `neq.${value}`)
    return this
  }

  gt(column, value) {
    this._params.append(column, `gt.${value}`)
    return this
  }

  gte(column, value) {
    this._params.append(column, `gte.${value}`)
    return this
  }

  lt(column, value) {
    this._params.append(column, `lt.${value}`)
    return this
  }

  lte(column, value) {
    this._params.append(column, `lte.${value}`)
    return this
  }

  in(column, values) {
    // PostgREST: ?col=in.(val1,val2,val3)
    const list = Array.isArray(values) ? values.join(',') : values
    this._params.append(column, `in.(${list})`)
    return this
  }

  ilike(column, pattern) {
    this._params.append(column, `ilike.${pattern}`)
    return this
  }

  like(column, pattern) {
    this._params.append(column, `like.${pattern}`)
    return this
  }

  is(column, value) {
    // PostgREST: ?col=is.null or ?col=is.true
    this._params.append(column, `is.${value}`)
    return this
  }

  not(column, operator, value) {
    // PostgREST: ?col=not.operator.value
    // e.g. .not('status', 'in', '("resolved","verified")')
    this._params.append(column, `not.${operator}.${value}`)
    return this
  }

  /**
   * PostgREST OR filter.
   * Accepts the Supabase-style filter string directly, e.g.:
   *   .or('title.ilike.%foo%,ticket_number.eq.42')
   * Maps to: ?or=(title.ilike.%foo%,ticket_number.eq.42)
   */
  or(filterString) {
    this._params.append('or', `(${filterString})`)
    return this
  }

  contains(column, value) {
    this._params.append(column, `cs.${JSON.stringify(value)}`)
    return this
  }

  containedBy(column, value) {
    this._params.append(column, `cd.${JSON.stringify(value)}`)
    return this
  }

  // ── Modifiers ───────────────────────────────────────────────────

  select(columns = '*', { count, head } = {}) {
    this._selectCalled = true
    if (columns && columns !== '*') {
      this._params.set('select', columns)
    }
    if (count === 'exact') {
      this._wantCount = true
      this._headers['Prefer'] = this._headers['Prefer']
        ? `${this._headers['Prefer']}, count=exact`
        : 'count=exact'
    }
    if (head) {
      this._isHead = true
      this._method = 'HEAD'
    }
    return this
  }

  order(column, { ascending = true } = {}) {
    const direction = ascending ? 'asc' : 'desc'
    const existing = this._params.get('order')
    if (existing) {
      this._params.set('order', `${existing},${column}.${direction}`)
    } else {
      this._params.set('order', `${column}.${direction}`)
    }
    return this
  }

  range(from, to) {
    this._headers['Range-Unit'] = 'items'
    this._headers['Range'] = `${from}-${to}`
    return this
  }

  limit(n) {
    this._params.append('limit', n)
    return this
  }

  offset(n) {
    this._params.append('offset', n)
    return this
  }

  single() {
    this._isSingle = true
    this._headers['Accept'] = 'application/vnd.pgrst.object+json'
    return this
  }

  maybeSingle() {
    this._isMaybeSingle = true
    this._headers['Accept'] = 'application/vnd.pgrst.object+json'
    return this
  }

  // ── Mutation starters ───────────────────────────────────────────

  insert(data) {
    this._method = 'POST'
    this._body = data
    this._headers['Content-Type'] = 'application/json'
    this._headers['Prefer'] = 'return=representation'
    return this
  }

  update(data) {
    this._method = 'PATCH'
    this._body = data
    this._headers['Content-Type'] = 'application/json'
    this._headers['Prefer'] = 'return=representation'
    return this
  }

  delete() {
    this._method = 'DELETE'
    this._headers['Prefer'] = 'return=representation'
    return this
  }

  upsert(data, { onConflict } = {}) {
    this._method = 'POST'
    this._body = data
    this._headers['Content-Type'] = 'application/json'
    this._headers['Prefer'] = 'return=representation, resolution=merge-duplicates'
    if (onConflict) {
      this._params.set('on_conflict', onConflict)
    }
    return this
  }

  // ── Execution ───────────────────────────────────────────────────

  async _execute() {
    const qs = this._params.toString()
    const url = qs ? `${this._url}?${qs}` : this._url

    // Default Accept header for non-single/non-head requests
    if (!this._headers['Accept']) {
      this._headers['Accept'] = 'application/json'
    }

    try {
      const res = await fetch(url, {
        method: this._method,
        headers: this._headers,
        body: this._body ? JSON.stringify(this._body) : undefined,
      })

      // Parse count from Content-Range header: "0-9/42" or "*/42"
      let count = null
      if (this._wantCount) {
        const contentRange = res.headers.get('Content-Range')
        if (contentRange) {
          const total = contentRange.split('/').pop()
          if (total && total !== '*') {
            count = parseInt(total, 10)
          }
        }
      }

      // HEAD requests return no body
      if (this._isHead) {
        return { data: null, error: null, count }
      }

      // No content (e.g. DELETE with no Prefer header)
      if (res.status === 204) {
        return { data: null, error: null, count }
      }

      // Handle maybeSingle 406 (no rows found with object Accept header)
      if (this._isMaybeSingle && res.status === 406) {
        return { data: null, error: null, count }
      }

      if (!res.ok) {
        let errorBody
        try {
          errorBody = await res.json()
        } catch {
          errorBody = { message: res.statusText }
        }

        // maybeSingle: return null instead of error for "not found" cases
        if (this._isMaybeSingle) {
          return { data: null, error: null, count }
        }

        return {
          data: null,
          error: {
            message: errorBody.message || res.statusText,
            details: errorBody.details || null,
            hint: errorBody.hint || null,
            code: errorBody.code || String(res.status),
          },
          count,
        }
      }

      const data = await res.json()

      // For single() with insert/update, PostgREST returns an array with
      // Prefer: return=representation. If the Accept header requests an object
      // but the response is still an array (e.g. not all PostgREST versions
      // honor the Accept header for mutations), unwrap it.
      if (this._isSingle && Array.isArray(data)) {
        return { data: data[0] || null, error: null, count }
      }

      return { data, error: null, count }
    } catch (err) {
      return {
        data: null,
        error: { message: err.message, details: null, hint: null, code: 'FETCH_ERROR' },
        count: null,
      }
    }
  }

  /**
   * Make the builder thenable so `await supabase.from('x').select('*')` works.
   */
  then(resolve, reject) {
    return this._execute().then(resolve, reject)
  }
}

/**
 * PostgREST client that mimics the @supabase/supabase-js API surface.
 */
export const supabase = {
  from(table) {
    return new PostgRESTFilterBuilder(`${API_URL}/${table}`)
  },

  /**
   * Call a PostgREST RPC function.
   * POST /api/rpc/{fn} with JSON body.
   */
  async rpc(fn, args = {}) {
    try {
      const rpcHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
      if (API_KEY) {
        rpcHeaders['apikey'] = API_KEY
        rpcHeaders['Authorization'] = `Bearer ${API_KEY}`
      }
      const res = await fetch(`${API_URL}/rpc/${fn}`, {
        method: 'POST',
        headers: rpcHeaders,
        body: JSON.stringify(args),
      })

      if (!res.ok) {
        let errorBody
        try {
          errorBody = await res.json()
        } catch {
          errorBody = { message: res.statusText }
        }
        return {
          data: null,
          error: {
            message: errorBody.message || res.statusText,
            details: errorBody.details || null,
            hint: errorBody.hint || null,
            code: errorBody.code || String(res.status),
          },
        }
      }

      const data = await res.json()
      return { data, error: null }
    } catch (err) {
      return {
        data: null,
        error: { message: err.message, details: null, hint: null, code: 'FETCH_ERROR' },
      }
    }
  },
}
