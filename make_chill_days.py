import numpy as np
import pandas as pd
import xarray as xr
import gcsfs
from pathlib import Path


# -----------------------------
# Configuration
# -----------------------------

CATALOG_URL = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"

OUTPUT_PATH = Path("data/chill_days.csv")

SCENARIOS = ["ssp126", "ssp245", "ssp585"]

VARIABLE_ID = "tasmin"
TABLE_ID = "day"
MEMBER_ID = "r1i1p1f1"

# Continental U.S. bounding box
LAT_MIN, LAT_MAX = 24, 50

# CMIP6 often uses longitude 0–360.
# -125 to -66 becomes 235 to 294.
LON_MIN, LON_MAX = 235, 294

YEAR_START = "2020-01-01"
YEAR_END = "2100-12-31"

# Chill day threshold
CHILL_MIN_F = 32
CHILL_MAX_F = 45

# Use 1 for original CMIP6 resolution.
# Use 2 or 3 only if you want a smaller/faster dataset.
COARSEN_FACTOR = 1

# Visual refinement for D3 map.
# 1 = original grid
# 2 = smoother grid, about 4x as many cells
# 3 = much larger file, only use if performance is okay
REFINE_FACTOR = 2


# -----------------------------
# Helper functions
# -----------------------------

def kelvin_to_fahrenheit(kelvin):
    """Convert Kelvin to Fahrenheit."""
    return (kelvin - 273.15) * 9 / 5 + 32


def choose_dataset(catalog, scenario):
    """
    Pick one matching CMIP6 Zarr store.

    We prefer grid_label == 'gr' if available because it is usually easier
    for mapping. Otherwise, use the first available match.
    """
    matches = catalog.query(
        "experiment_id == @scenario "
        "and table_id == @TABLE_ID "
        "and variable_id == @VARIABLE_ID "
        "and member_id == @MEMBER_ID"
    ).copy()

    if matches.empty:
        raise ValueError(f"No dataset found for scenario: {scenario}")

    gr_matches = matches[matches["grid_label"] == "gr"]

    if not gr_matches.empty:
        chosen = gr_matches.iloc[0]
    else:
        chosen = matches.iloc[0]

    print(f"\nChosen dataset for {scenario}:")
    print("source_id:", chosen["source_id"])
    print("experiment_id:", chosen["experiment_id"])
    print("table_id:", chosen["table_id"])
    print("variable_id:", chosen["variable_id"])
    print("member_id:", chosen["member_id"])
    print("grid_label:", chosen["grid_label"])

    return chosen


def refine_grid(data_array, factor):
    """
    Interpolate the annual chill-day grid to a finer lat/lon grid.

    This is for visualization smoothness only. It does not create new
    original climate observations; it interpolates between CMIP6 grid cells.
    """
    if factor <= 1:
        return data_array

    lat_values = np.sort(data_array["lat"].values)
    lon_values = np.sort(data_array["lon"].values)

    new_lat = np.linspace(
        lat_values.min(),
        lat_values.max(),
        len(lat_values) * factor
    )

    new_lon = np.linspace(
        lon_values.min(),
        lon_values.max(),
        len(lon_values) * factor
    )

    refined = data_array.interp(
        lat=new_lat,
        lon=new_lon,
        method="linear"
    )

    return refined


def compute_chill_days_for_scenario(catalog, gcs, scenario):
    """
    Load one CMIP6 scenario and compute annual chill days for each grid cell.
    """
    chosen = choose_dataset(catalog, scenario)

    mapper = gcs.get_mapper(chosen["zstore"])
    ds = xr.open_zarr(mapper, consolidated=True)

    if VARIABLE_ID not in ds:
        raise ValueError(f"{VARIABLE_ID} not found in dataset for {scenario}")

    tasmin = ds[VARIABLE_ID]

    # Convert Kelvin to Fahrenheit
    tasmin_f = kelvin_to_fahrenheit(tasmin)

    # Subset to continental U.S. and selected years
    tasmin_us = tasmin_f.sel(
        lat=slice(LAT_MIN, LAT_MAX),
        lon=slice(LON_MIN, LON_MAX),
        time=slice(YEAR_START, YEAR_END)
    )

    # Optional coarsening to reduce output size
    if COARSEN_FACTOR > 1:
        tasmin_us = tasmin_us.coarsen(
            lat=COARSEN_FACTOR,
            lon=COARSEN_FACTOR,
            boundary="trim"
        ).mean()

    # A chill day is a day where daily minimum temperature is 32°F–45°F
    chill_mask = (tasmin_us >= CHILL_MIN_F) & (tasmin_us <= CHILL_MAX_F)

    # Count chill days per year at each grid cell
    annual_chill = chill_mask.groupby("time.year").sum(dim="time")

    # Force computation before interpolation/dataframe conversion
    print(f"Computing annual chill days for {scenario}...")
    annual_chill = annual_chill.compute()

    # Refine grid for smoother D3 visualization
    if REFINE_FACTOR > 1:
        print(f"Refining grid by factor {REFINE_FACTOR} for {scenario}...")
        annual_chill = refine_grid(annual_chill, REFINE_FACTOR)

    # Convert to dataframe for D3
    df = annual_chill.to_dataframe(name="chill_days").reset_index()

    # Convert longitude from 0–360 to -180–180
    df["lon"] = df["lon"].where(df["lon"] <= 180, df["lon"] - 360)

    # Add scenario column
    df["scenario"] = scenario

    # Keep only useful columns
    df = df[["lat", "lon", "year", "scenario", "chill_days"]]

    return df


# -----------------------------
# Main script
# -----------------------------

def main():
    print("Loading CMIP6 catalog...")
    catalog = pd.read_csv(CATALOG_URL)

    gcs = gcsfs.GCSFileSystem(token="anon")

    all_results = []

    for scenario in SCENARIOS:
        print(f"\nProcessing scenario: {scenario}")
        scenario_df = compute_chill_days_for_scenario(catalog, gcs, scenario)
        all_results.append(scenario_df)

    final_df = pd.concat(all_results, ignore_index=True)

    # Remove missing values
    final_df = final_df.dropna()

    # Round coordinates to reduce file size
    final_df["lat"] = final_df["lat"].round(3)
    final_df["lon"] = final_df["lon"].round(3)

    # Chill days should be integer counts
    final_df["chill_days"] = final_df["chill_days"].round().astype(int)

    # Sort for cleaner debugging and predictable D3 loading
    final_df = final_df.sort_values(
        ["scenario", "year", "lat", "lon"]
    ).reset_index(drop=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    final_df.to_csv(OUTPUT_PATH, index=False)

    print("\nDone.")
    print(f"Saved to: {OUTPUT_PATH}")
    print("Rows:", len(final_df))
    print("\nPreview:")
    print(final_df.head())


if __name__ == "__main__":
    main()