import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { caseKey, isWorkflowUpdate, transition } from '../src/engine/workflow.ts'
import type { WorkflowEntry } from '../src/engine/workflow.ts'
import { requestBody, send } from './http.ts'

export function workflowHandler(path: string) {
  const file = resolve(path)
  function records(): WorkflowEntry[] {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as WorkflowEntry[] : []
  }

  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET') {
      try { send(response, 200, records()) }
      catch { send(response, 500, { error: 'Could not read the incident workflow store.' }) }
      return
    }
    if (request.method !== 'POST') { send(response, 405, { error: 'Expected GET or POST' }); return }
    let update: unknown
    try { update = await requestBody(request) }
    catch (error) { send(response, 400, { error: (error as Error).message }); return }
    if (!isWorkflowUpdate(update)) { send(response, 400, { error: 'Invalid workflow update' }); return }
    try {
      const current = records()
      const index = current.findIndex((entry) => caseKey(entry.incident) === caseKey(update.incident))
      let entry
      try { entry = transition(current[index], update, Date.now()) }
      catch (error) { send(response, 409, { error: (error as Error).message }); return }
      if (index < 0) current.push(entry)
      else current[index] = entry
      mkdirSync(dirname(file), { recursive: true })
      const temporary = file + '.' + process.pid + '.tmp'
      writeFileSync(temporary, JSON.stringify(current), 'utf8')
      renameSync(temporary, file)
      send(response, 200, entry)
    } catch { send(response, 500, { error: 'Could not save the incident workflow.' }) }
  }
}
