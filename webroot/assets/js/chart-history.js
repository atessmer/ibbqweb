const isValidProbeReading = (r) => {
   return r !== null && typeof r === 'object' && !Array.isArray(r) &&
      Number.isSafeInteger(r.ts) && Math.abs(r.ts) <= 8.64e15 &&
      Array.isArray(r.probes) && r.probes.length >= 1 && r.probes.length <= 4 &&
      r.probes.every((p) => p === null ||
         (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 6553.5))
}

const normalizeProbeReadings = (readings) => readings.slice().sort((a, b) => a.ts - b.ts)

const validateSavedProbeReadings = (readings) => {
   if (!Array.isArray(readings) || !readings.every(isValidProbeReading)) {
      throw new Error('Invalid data structure')
   }

   if (readings.length === 0) {
      return []
   }

   const probeCount = readings[0].probes.length
   const timestamps = new Set()
   for (const reading of readings) {
      if (reading.probes.length !== probeCount || timestamps.has(reading.ts)) {
         throw new Error('Invalid data structure')
      }
      timestamps.add(reading.ts)
   }

   // Files may contain readings in arrival order; normalize them after checking
   // that timestamps are unique so sorting cannot hide ambiguous samples.
   return normalizeProbeReadings(readings)
}


export { validateSavedProbeReadings };
