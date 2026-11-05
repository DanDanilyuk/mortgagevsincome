#!/usr/bin/env ruby

# Decides whether the scheduled workflow should run the data pipeline.
#
# Cron can't target the monthly sources on its own: BLS release dates shift month
# to month and Zillow lands mid-month with no published calendar. So the workflow
# checks every weekday and this gate skips the run unless FRED reports something
# new since the last one. That also retries a late Thursday rate the next morning.

require 'json'
require 'net/http'
require 'time'
require 'uri'

module UpstreamCheck
  DATA_FILE = 'weekly_case_shiller_output.json'

  # The pipeline reads CES0500000011 from BLS, but FRED mirrors it, so one API covers
  # every source. USAUCSFRCONDOSMSAMID stands in for the per-state ZHVI series, which
  # share its release.
  SERIES = %w[MORTGAGE30US CES0500000011 CPIAUCSL USAUCSFRCONDOSMSAMID].freeze

  # Regenerate at least this often so a fault in this check can't silently stop updates.
  MAX_AGE_SECONDS = 7 * 86_400

  # Returns why the pipeline should run, or nil to skip it. Anything unknown means run:
  # a needless run costs one commit, a wrong skip leaves the site stale.
  def self.reason_to_run(generated_at:, last_updated:, now:, force: false)
    return 'manual run' if force
    return 'no readable generated_at' if generated_at.nil?
    return 'last run is at least a week old' if now - generated_at >= MAX_AGE_SECONDS

    unknown = last_updated.select { |_, time| time.nil? }.keys
    return "no update time for #{unknown.join(', ')}" if unknown.any?

    newer = last_updated.select { |_, time| time > generated_at }.keys
    "new data in #{newer.join(', ')}" if newer.any?
  end

  def self.parse_time(value)
    Time.parse(value.to_s)
  rescue ArgumentError
    nil
  end

  def self.parse_last_updated(body)
    parse_time(JSON.parse(body).dig('seriess', 0, 'last_updated'))
  rescue JSON::ParserError
    nil
  end

  def self.read_generated_at(data_file)
    parse_time(JSON.parse(File.read(data_file)).dig('metadata', 'generated_at'))
  rescue Errno::ENOENT, JSON::ParserError
    nil
  end

  def self.fetch_last_updated(series_id, api_key)
    uri = URI('https://api.stlouisfed.org/fred/series')
    uri.query = URI.encode_www_form(series_id: series_id, api_key: api_key, file_type: 'json')
    options = { use_ssl: true, verify_mode: OpenSSL::SSL::VERIFY_PEER, open_timeout: 30, read_timeout: 60 }
    response = Net::HTTP.start(uri.host, uri.port, options) { |http| http.get(uri.request_uri) }
    raise "HTTP #{response.code}" unless response.code.to_i == 200

    parse_last_updated(response.body)
  end

  def self.lookup(series_id, api_key, fetch)
    time = fetch.call(series_id, api_key)
    puts "  #{series_id}: last updated #{time&.getutc&.iso8601 || 'unknown'}"
    time
  rescue StandardError => e
    # Class name only: a message can carry the request URL, and CI logs are public.
    puts "  #{series_id}: lookup failed (#{e.class})"
    nil
  end

  def self.main(env: ENV, data_file: DATA_FILE, now: Time.now, fetch: method(:fetch_last_updated))
    last_updated = SERIES.to_h { |series_id| [series_id, lookup(series_id, env['FRED_API_KEY'], fetch)] }
    reason = reason_to_run(
      generated_at: read_generated_at(data_file),
      last_updated: last_updated,
      now: now,
      force: env['FORCE_RUN'] == 'true'
    )

    puts reason ? "✅ Running: #{reason}" : '⏭️ Nothing new upstream - skipping'
    File.write(env['GITHUB_OUTPUT'], "skip=#{reason.nil?}\n", mode: 'a') if env['GITHUB_OUTPUT']
  end
end

UpstreamCheck.main if $PROGRAM_NAME == __FILE__
