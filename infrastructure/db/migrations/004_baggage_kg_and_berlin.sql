-- Migration 004: add baggage_kg column and fix Berlin Brandenburg airport

-- Add baggage_kg to flights table
-- SQLite does not support IF NOT EXISTS on ALTER TABLE; ignore error if column exists
ALTER TABLE flights ADD COLUMN baggage_kg REAL;

-- Fix Berlin airport: EDDB was mapped to SXF (Schönefeld, now closed).
-- Berlin Brandenburg Airport opened 2020-10-31, ICAO: EDDB, IATA: BER.
UPDATE airports
SET name = 'Berlin Brandenburg Airport',
    iata = 'BER',
    latitude = 52.3667,
    longitude = 13.5033
WHERE icao = 'EDDB';

-- Backfill dep_icao/arr_icao for any Norwegian flights with BER IATA but null ICAO
-- (these were imported before the airport fix; re-import will fix them properly too)
UPDATE flights SET dep_icao = 'EDDB' WHERE dep_iata = 'BER' AND dep_icao IS NULL;
UPDATE flights SET arr_icao = 'EDDB' WHERE arr_iata = 'BER' AND arr_icao IS NULL;
