require_relative 'test_helper'
require_relative '../upstream_check'
require 'tmpdir'

class UpstreamCheckTest < Minitest::Test
  LAST_RUN = '2026-10-29T17:43:34-04:00' # 21:43:34 UTC, format the pipeline writes
  NOON_SLOT = Time.utc(2026, 11, 5, 17, 10) # 6d 19h after LAST_RUN
  BEFORE_LAST_RUN = Time.utc(2026, 10, 15, 8, 34)
  AFTER_LAST_RUN = Time.utc(2026, 11, 5, 17, 2, 36)

  # Runs the real entry point against a real data file and GITHUB_OUTPUT file;
  # only the network call is replaced. Returns [skip output, stdout + stderr].
  def run_check(generated_at: LAST_RUN, updates: {}, now: NOON_SLOT, force: nil, fetch: nil)
    Dir.mktmpdir do |dir|
      data_file = File.join(dir, 'national.json')
      File.write(data_file, JSON.generate('metadata' => { 'generated_at' => generated_at })) if generated_at
      output_file = File.join(dir, 'github_output')
      env = { 'FRED_API_KEY' => 'test-key', 'GITHUB_OUTPUT' => output_file, 'FORCE_RUN' => force }
      fetch ||= ->(series_id, _key) { updates.fetch(series_id, BEFORE_LAST_RUN) }

      stdout, stderr = capture_io do
        UpstreamCheck.main(env: env, data_file: data_file, now: now, fetch: fetch)
      end
      [File.read(output_file), stdout + stderr]
    end
  end

  def test_skips_when_no_source_changed_since_the_last_run
    output, = run_check
    assert_equal "skip=true\n", output
  end

  %w[MORTGAGE30US CES0500000011 CPIAUCSL USAUCSFRCONDOSMSAMID].each do |series|
    define_method("test_new_#{series}_release_triggers_a_run") do
      output, log = run_check(updates: { series => AFTER_LAST_RUN })
      assert_equal "skip=false\n", output
      assert_includes log, series
    end
  end

  # The 6-hour window this replaced would have skipped here: a morning run for a
  # monthly release must not swallow the mortgage rate published at noon.
  def test_morning_run_does_not_swallow_the_noon_rate
    output, = run_check(
      generated_at: '2026-11-05T09:45:00-05:00',
      updates: { 'MORTGAGE30US' => AFTER_LAST_RUN }
    )
    assert_equal "skip=false\n", output
  end

  def test_release_already_included_in_the_last_run_is_not_new
    output, = run_check(updates: { 'CPIAUCSL' => Time.utc(2026, 10, 29, 21, 43, 34) })
    assert_equal "skip=true\n", output
  end

  def test_regenerates_after_a_week_even_with_nothing_new
    output, = run_check(now: Time.utc(2026, 11, 5, 21, 43, 34))
    assert_equal "skip=false\n", output
  end

  def test_does_not_regenerate_just_under_a_week
    output, = run_check(now: Time.utc(2026, 11, 5, 21, 43, 33))
    assert_equal "skip=true\n", output
  end

  def test_runs_when_there_is_no_previous_output
    output, = run_check(generated_at: nil)
    assert_equal "skip=false\n", output
  end

  def test_runs_when_generated_at_is_unreadable
    output, = run_check(generated_at: 'not a time')
    assert_equal "skip=false\n", output
  end

  def test_manual_dispatch_always_runs
    output, = run_check(force: 'true')
    assert_equal "skip=false\n", output
  end

  def test_force_flag_of_false_does_not_force
    output, = run_check(force: 'false')
    assert_equal "skip=true\n", output
  end

  def test_runs_when_fred_cannot_be_reached
    output, = run_check(fetch: ->(_series, _key) { raise SocketError, 'getaddrinfo failed' })
    assert_equal "skip=false\n", output
  end

  def test_runs_when_one_update_time_is_unknown
    output, = run_check(fetch: ->(series, _key) { series == 'CPIAUCSL' ? nil : BEFORE_LAST_RUN })
    assert_equal "skip=false\n", output
  end

  def test_fetch_errors_never_print_the_api_key
    secret = 'abcd1234abcd1234abcd1234abcd1234'
    failing = ->(_series, _key) { raise "GET /fred/series?api_key=#{secret} failed" }
    _, log = run_check(fetch: failing)
    refute_includes log, secret
  end

  def test_parses_the_documented_fred_series_response
    body = JSON.generate(
      'realtime_start' => '2026-11-05',
      'realtime_end' => '2026-11-05',
      'seriess' => [{
        'id' => 'MORTGAGE30US',
        'realtime_start' => '2026-11-05',
        'realtime_end' => '2026-11-05',
        'title' => '30-Year Fixed Rate Mortgage Average in the United States',
        'observation_start' => '1971-04-02',
        'observation_end' => '2026-11-05',
        'frequency' => 'Weekly, Ending Thursday',
        'frequency_short' => 'W',
        'units' => 'Percent',
        'units_short' => '%',
        'seasonal_adjustment' => 'Not Seasonally Adjusted',
        'seasonal_adjustment_short' => 'NSA',
        'last_updated' => '2026-11-05 11:02:36-06',
        'popularity' => 95
      }]
    )
    assert_equal Time.utc(2026, 11, 5, 17, 2, 36), UpstreamCheck.parse_last_updated(body)
  end

  def test_parse_returns_nil_for_bodies_without_an_update_time
    ['{}', '{"seriess":[]}', '{"seriess":[{"id":"X"}]}', '{"seriess":[{"last_updated":"garbage"}]}', 'not json'].each do |body|
      assert_nil UpstreamCheck.parse_last_updated(body), body
    end
  end
end
