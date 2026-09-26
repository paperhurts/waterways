import { describe, expect, it } from "vitest";
import { parkHref, parkLine, parkSlug } from "../shared/parks";
import { counties, shortName } from "./names";

describe("park names", () => {
  it("shortens names for labels", () => {
    expect(shortName("Edward Ball Wakulla Springs State Park")).toBe("Wakulla Springs");
    expect(shortName("Paynes Prairie Preserve State Park")).toBe("Paynes Prairie");
    expect(shortName("Windley Key Fossil Reef Geological State Park")).toBe("Windley Key Fossil Reef");
    expect(shortName("Rock Springs Run State Reserve")).toBe("Rock Springs Run");
    expect(shortName("Gamble Rogers Memorial State Recreation Area at Flagler Beach")).toBe("Gamble Rogers");
    expect(shortName("Marjorie Harris Carr Cross Florida Greenways State Recreation and Conservation Area")).toBe("Cross Florida Greenway");
    expect(shortName("Florida Keys Overseas Heritage Trail")).toBe("Florida Keys Overseas Heritage Trail");
  });

  it("lists counties in plain English", () => {
    expect(counties("Levy")).toBe("Levy County");
    expect(counties("Lee, Charlotte")).toBe("Lee and Charlotte counties");
    expect(counties("Citrus, Levy, Marion, Putnam")).toBe("Citrus, Levy, Marion, and Putnam counties");
  });

  it("links a park by a URL-safe slug, and escapes its name", () => {
    expect(parkSlug("O'Leno State Park")).toBe("o-leno-state-park");
    expect(parkSlug('William J "Billy Joe" Rish Recreation Area')).toBe("william-j-billy-joe-rish-recreation-area");
    expect(parkHref("Troy Spring State Park")).toBe("parks.html#troy-spring-state-park");
    expect(parkLine("")).toBe("");
    expect(parkLine("A <b> Park")).toBe('In <a href="parks.html#a-b-park">A &#60;b&#62; Park</a>. ');
  });
});
