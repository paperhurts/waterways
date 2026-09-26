// How the parks map names parks and their counties.

/** A park's name without "State Park" and the like, for labels and lists. */
export function shortName(name: string): string {
  return name
    .replace(/^Marjorie Harris Carr (Cross Florida Greenway)s .*$/, "$1")
    .replace(/ (Memorial )?State Recreation Area at .*$/, "")
    .replace(/^(Edward Ball|Ruth B\. Kirby|Ellie Schiller|Wes Skiles|Dr\. Julian G\. Bruce|T\.H\. Stone Memorial|Allen David Broussard|Mike Roess|Fred Gannon|Dr\. Von D\.) /, "")
    .replace(/ (Historic |Archaeological |Geological |Botanical |Cultural |Memorial |Wildlife )?(State Park|State Reserve|State Recreation Area|State Archaeological Site)$/, "")
    .replace(/ Preserve$/, "");
}

/** "Levy County", "Lee and Charlotte counties", "Citrus, Levy, Marion, and Putnam counties". */
export function counties(list: string): string {
  const cs = list.split(",").map((c) => c.trim()).filter(Boolean);
  if (cs.length <= 1) return cs.length ? `${cs[0]} County` : "Florida";
  const head = cs.slice(0, -1).join(", ");
  return `${head}${cs.length > 2 ? "," : ""} and ${cs[cs.length - 1]} counties`;
}
