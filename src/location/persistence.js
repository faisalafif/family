export async function persistLocationResult(client, memberId, result) {
  const recordedAt = result.timestamp || new Date().toISOString();
  const { error: insertError } = await client.from("locations").insert({
    member_id: memberId,
    latitude: result.latitude,
    longitude: result.longitude,
    accuracy: result.accuracy,
    source: result.source,
    provider: result.provider,
    recorded_at: recordedAt,
    confidence: result.confidence,
    metadata: result.rawProviderData || {}
  });
  if (insertError) throw insertError;
  const { error: updateError } = await client.from("family_members").update({
    latitude: result.latitude,
    longitude: result.longitude,
    accuracy: result.accuracy,
    last_seen: recordedAt,
    last_source: result.source,
    last_provider: result.provider
  }).eq("id", memberId);
  if (updateError) throw updateError;
  return recordedAt;
}
