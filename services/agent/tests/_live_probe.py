"""Scratch: replay a scenario against the REAL model with full tracebacks. Not committed."""

import os

import pytest

from myna_agent.llm.sarvam import SarvamNLU, WithFallback
from myna_agent.nlu import RuleBasedNLU
from myna_agent.settings import load_dotenv

pytestmark = pytest.mark.api
load_dotenv()


async def test_probe(make_call, make_tenant):
    nlu = WithFallback(
        SarvamNLU(os.environ["SARVAM_API_KEY"], model="sarvam-105b-conversations"), RuleBasedNLU()
    )
    t = await make_tenant()
    call = await make_call(caller_phone="9822200111", clinic_id=t["clinicId"], nlu=nlu)
    r = await call.start()
    for say in [
        "Mujhe cleaning ka appointment chahiye kal subah 11 baje.",
        "Mera naam Neha Kapoor hai.",
        "15 March 1992",
        "Haan ji.",
        "Nahi, bas. Thank you.",
    ]:
        print("CALLER:", say)
        r = await call.say(say)
        print("  MYNA:", r.text[:110], "| ended:", r.ended, r.state)
